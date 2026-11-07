import test from "node:test";
import assert from "node:assert/strict";
import {createInventoryHandler} from "../netlify/functions/hmp-inventory.mts";

globalThis.Netlify = {env:{get:key => ({HMP_ADMIN_EMAILS:"admin@example.com"})[key]}};
const admin = {email:"admin@example.com"};
const request = (method = "GET", body = null, query = "", origin = "https://hmpeds.com") => new Request(`https://hmpeds.com/api/hmp-inventory${query}`, {
  method, headers:{origin,"Content-Type":"application/json"}, ...(body ? {body:JSON.stringify(body)} : {}),
});
function fixture(user = admin) {
  const rows = new Map();
  const photos = new Set();
  const db = {from(table) {
    assert.equal(table,"hmp_seating_records");
    let filters = [];
    const chain = {
      select() { return chain; },
      eq(column,value) { filters.push(row => column === "key" ? row.key === value : row.value.version === value); return chain; },
      like(_column,pattern) { filters.push(row => row.key.startsWith(pattern.slice(0,-1))); return chain; },
      limit() { return Promise.resolve({data:[...rows.values()].filter(row => filters.every(fn=>fn(row))),error:null}); },
      maybeSingle() { return Promise.resolve({data:[...rows.values()].find(row => filters.every(fn=>fn(row))) || null,error:null}); },
      insert(input) { for (const row of (Array.isArray(input) ? input : [input])) rows.set(row.key,row); return Promise.resolve({error:null}); },
      update(update) { chain.pending = update; return chain; },
      async then(resolve,reject) { return Promise.resolve({data:null,error:null}).then(resolve,reject); },
    };
    const originalMaybeSingle = chain.maybeSingle;
    chain.maybeSingle = async () => {
      const row = await originalMaybeSingle();
      if (!chain.pending) return row;
      if (!row.data) return row;
      const next = {...row.data,...chain.pending}; rows.set(next.key,next);
      return {data:{key:next.key},error:null};
    };
    return chain;
  }, storage:{from(bucket) {
    assert.equal(bucket,"hmp-conversation-attachments");
    return {
      async createSignedUploadUrl(path) { return {data:{signedUrl:`https://synthetic.storage/upload/${path}`},error:null}; },
      async createSignedUrl(path) { return {data:{signedUrl:`https://synthetic.storage/read/${path}`},error:null}; },
      async list(folder) { return {data:[...photos].filter(path=>path.startsWith(`${folder}/`)).map(path=>({name:path.slice(folder.length+1)})),error:null}; },
      async remove(paths) { for(const path of paths) photos.delete(path); return {error:null}; },
    };
  }}};
  const handler = createInventoryHandler({getUserFn:async()=>user,databaseFactory:()=>db});
  return {rows,photos,handler};
}

test("inventory requires verified Admin and same-origin mutations", async () => {
  assert.equal((await fixture(null).handler(request())).status,401);
  assert.equal((await fixture({email:"guest@example.com"}).handler(request())).status,401);
  assert.equal((await fixture().handler(request("POST",{action:"create-event",name:"Gala"},"","https://other.example"))).status,403);
});

test("item details and photos stay private and require a completed upload", async () => {
  const {handler,photos} = fixture();
  const event=(await (await handler(request("POST",{action:"create-event",name:"Gala"}))).json()).event;
  const item=(await (await handler(request("POST",{action:"add-items",eventId:event.id,items:[{name:"Gift box"}]}))).json()).items[0];
  const prepared=await handler(request("POST",{action:"prepare-photo",eventId:event.id,itemId:item.id,type:"image/png",size:400}));
  assert.equal(prepared.status,200);
  const {path}=await prepared.json();
  assert.equal((await handler(request("PATCH",{action:"attach-photo",eventId:event.id,itemId:item.id,expectedVersion:item.version,path}))).status,400);
  photos.add(path);
  const saved=await handler(request("PATCH",{action:"attach-photo",eventId:event.id,itemId:item.id,expectedVersion:item.version,path}));
  assert.equal(saved.status,200);
  const withPhoto=(await saved.json()).item;
  assert.match(withPhoto.photo.url,/synthetic.storage\/read/);
  const details=await handler(request("PATCH",{action:"update-details",eventId:event.id,itemId:item.id,expectedVersion:withPhoto.version,details:"Blue boxes, backstage"}));
  assert.equal(details.status,200);
  const list=(await (await handler(request("GET",null,`?event=${event.id}`))).json()).items;
  assert.equal(list[0].details,"Blue boxes, backstage");
  assert.match(list[0].photo.url,/synthetic.storage\/read/);
  assert.equal((await fixture(null).handler(request("GET",null,`?event=${event.id}`))).status,401);
});

test("Admin can create items, print private QR, and track check-out and check-in", async () => {
  const {handler} = fixture();
  const created = await handler(request("POST",{action:"create-event",name:"Gala",date:"2026-12-03"}));
  assert.equal(created.status,201);
  const event = (await created.json()).event;
  const added = await handler(request("POST",{action:"add-items",eventId:event.id,items:[{name:"Gift box",label:"Gifts"}]}));
  assert.equal(added.status,201);
  const item = (await added.json()).items[0];
  const qr = await handler(request("GET",null,`?qr=1&event=${event.id}&item=${item.id}`));
  assert.equal(qr.status,200); assert.match(qr.headers.get("content-type"),/svg/); assert.match(await qr.text(),/<svg/);
  const checkedOut = await handler(request("PATCH",{action:"check-out",eventId:event.id,itemId:item.id,expectedVersion:item.version}));
  assert.equal(checkedOut.status,200);
  const out = (await checkedOut.json()).item;
  assert.equal(out.status,"out"); assert.equal(out.history.length,1);
  assert.equal((await handler(request("PATCH",{action:"check-in",eventId:event.id,itemId:item.id,expectedVersion:item.version}))).status,409);
  const checkedIn = await handler(request("PATCH",{action:"check-in",eventId:event.id,itemId:item.id,expectedVersion:out.version}));
  assert.equal(checkedIn.status,200);
  assert.equal((await checkedIn.json()).item.status,"in");
  const list = await handler(request("GET",null,`?event=${event.id}`));
  assert.equal((await list.json()).items[0].history.length,2);
});
