import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import { hubMessages, hubSectionFor, clientAccessNotice } from "../client-hub.js";
import { createMessagesHandler } from "../netlify/functions/hmp-messages.mts";

const conversationId = "11111111-1111-4111-8111-111111111111";
const inquiryId = "22222222-2222-4222-8222-222222222222";
const formId = "33333333-3333-4333-8333-333333333333";
const seatingEventId = "44444444-4444-4444-8444-444444444444";
const seatingToken = "a".repeat(48);
const settings = { HMP_ADMIN_EMAILS:"admin@example.test", SUPABASE_SERVICE_ROLE_KEY:"test-secret" };
globalThis.Netlify = { env:{get:key => settings[key]} };

function database() {
  const rows = {
    hmp_client_conversations:[{id:conversationId,inquiry_id:inquiryId,revoked_at:null,token_expires_at:"2099-01-01T00:00:00Z"}],
    hmp_admin_inquiries:[{submission_id:inquiryId,email:"client@example.test",celebration_date:"2026-10-20"}],
    hmp_client_agreements:[{id:formId,client_email:"client@example.test",status:"Sent",expires_at:"2099-01-01T00:00:00Z",token_nonce:"test-nonce",snapshot:{title:"Event details"}}],
    hmp_client_messages:[],
    hmp_seating_records:[
      {key:"public/naija-gala",value:{eventId:seatingEventId}},
      {key:`events/${seatingEventId}`,value:{id:seatingEventId,publicCode:"naija-gala",clientUploadToken:seatingToken,name:"Naija Gala",date:"2026-10-20"}},
      {key:`client-activity/${seatingEventId}/2026-10-20T12:00:00Z-one`,value:{id:"one",eventId:seatingEventId,action:"guest_added",summary:"Client added Sam Doe",createdAt:"2026-10-20T12:00:00Z"}},
    ],
  };
  return {rows,from(table) {
    let filters=[],operation="read",value,sort=null,window=null;
    const query = {
      select(){return this;},eq(key,expected){filters.push(row=>row[key]===expected);return this;},
      like(key,pattern){const prefix=pattern.slice(0,-1);filters.push(row=>String(row[key]).startsWith(prefix));return this;},
      order(key,{ascending=true}={}){sort={key,ascending};return this;},
      range(start,end){window={start,end};return this;},
      insert(payload){operation="insert";value=payload;return this;},
      update(payload){operation="update";value=payload;return this;},
      run(single=false){
        let found=rows[table].filter(row=>filters.every(filter=>filter(row)));
        if(sort) found.sort((left,right)=>sort.ascending
          ? String(left[sort.key]).localeCompare(String(right[sort.key]))
          : String(right[sort.key]).localeCompare(String(left[sort.key])));
        if(window) found=found.slice(window.start,window.end+1);
        if(operation==="insert") {
          if(rows[table].some(row=>row.id===value.id)) return {data:null,error:{code:"23505"}};
          rows[table].push(value);found=[value];
        }
        if(operation==="update") found.forEach(row=>Object.assign(row,value));
        return {data:single ? found[0] || null : found,error:null};
      },
      maybeSingle(){return Promise.resolve(this.run(true));},
      then(resolve,reject){return Promise.resolve(this.run()).then(resolve,reject);},
    };
    return query;
  }};
}

const request = (body, origin="https://hmpeds.com") => new Request("https://hmpeds.com/api/hmp-messages",{
  method:"POST",headers:{Origin:origin},body:JSON.stringify(body),
});
const body = {action:"share-form",conversationId,formId};
const handler = (db,user={email:"admin@example.test"},fetchFn=fetch) => createMessagesHandler({getUserFn:async()=>user,databaseFactory:()=>db,fetchFn});

test("hub access notice uses saved portal expiry in Eastern time, including expired and inactive links",()=>{
  const now=Date.parse("2026-10-30T12:00:00Z");
  const thread={active:true,expiresAt:"2026-11-16T04:59:59.999Z"};
  assert.equal(clientAccessNotice(thread,now),"Client access expires: November 15, 2026 at 11:59 PM Eastern time.");
  assert.equal(clientAccessNotice({...thread,expiresAt:"2026-10-30T03:59:59.999Z"},now),"Client access expired: October 29, 2026 at 11:59 PM Eastern time.");
  assert.match(clientAccessNotice({...thread,active:false},now),/^Client access is inactive\. Saved expiration:/);
  assert.match(clientAccessNotice(thread,Date.parse(thread.expiresAt)),/^Client access expired:/);
  for(const expiresAt of [undefined,null,"","invalid"]) assert.match(clientAccessNotice({active:false,expiresAt},now),/expiration is unavailable/);
});

test("hub expiry notice stays outside tabs and refreshes whenever the selected thread is rendered",()=>{
  const html=readFileSync(new URL("../admin.html",import.meta.url),"utf8");
  const source=readFileSync(new URL("../src/admin.js",import.meta.url),"utf8");
  assert.match(html,/<p class="client-access-expiry" id="admin-client-access-expiry"><\/p>\s*<\/header>\s*<nav/);
  assert.ok(source.includes('$("#admin-client-access-expiry").textContent = clientAccessNotice(thread);'));
});

test("personalized client heading capitalizes Event Hub and uses textContent", () => {
  const source = readFileSync(new URL("../conversation.js", import.meta.url), "utf8");
  assert.ok(source.includes('$("#conversation-title").textContent = `${data.conversation.clientName}’s Event Hub`;'));
  assert.ok(!source.includes('`${data.conversation.clientName}’s event hub`'));
});

test("client hub groups messages, proposals, invoices, contracts, forms, and Guest Seating", () => {
  const messages = [
    {sender:"client",body:"Hello"},
    {sender:"admin",body:'HMP_PROPOSAL_V1:{"title":"Test"}'},
    {sender:"admin",document:{kind:"invoice"}},
    {sender:"admin",document:{kind:"contract"}},
    {sender:"admin",document:{kind:"form"}},
    {sender:"admin",document:{kind:"seating"}},
  ];
  assert.deepEqual(messages.map(hubSectionFor),["messages","proposals","invoices","contracts","forms","seating"]);
  for(const section of ["messages","proposals","invoices","contracts","forms","seating"]) assert.equal(hubMessages(messages,section).length,1);
});

test("Admin links only a verified matching Guest Seating event to one client hub", async () => {
  const db = database();
  const url = `https://seating.hmpeds.com/client/naija-gala/${seatingToken}`;
  const seatBody = {action:"share-seating",conversationId,url};
  const h = handler(db);
  assert.equal((await handler(db,null)(request(seatBody))).status,401);
  assert.equal((await h(request(seatBody,"https://other.test"))).status,403);
  assert.equal((await h(request({...seatBody,url:"https://attacker.test/client/naija-gala/"+"a".repeat(48)}))).status,400);
  db.rows.hmp_seating_records[1].value.date = "2026-10-21";
  assert.equal((await h(request(seatBody))).status,409);
  db.rows.hmp_seating_records[1].value.date = "2026-10-20";
  assert.equal((await h(request({...seatBody,url:`https://seating.hmpeds.com/client/naija-gala/${"b".repeat(48)}`}))).status,400);
  assert.equal((await h(request(seatBody))).status,200);
  assert.equal(db.rows.hmp_client_messages[0].document.kind,"seating");
  assert.equal(db.rows.hmp_client_messages[0].document.url,url);
  assert.equal((await h(request(seatBody))).status,200);
  assert.equal(db.rows.hmp_client_messages.length,1);
  assert.equal((await h(request({...seatBody,url:`https://seating.hmpeds.com/client/other/${"b".repeat(48)}`}))).status,400);
  const activity = await h(request({action:"seating-activity",conversationId}));
  assert.equal(activity.status,200);
  assert.deepEqual((await activity.json()).activity.map((item) => item.kind),["guest_added"]);
  assert.equal((await handler(db,null)(request({action:"seating-activity",conversationId}))).status,401);
  assert.equal((await h(request({action:"seating-activity",conversationId},"https://other.test"))).status,403);
  db.rows.hmp_client_messages[0].deleted_at="2026-10-20T13:00:00Z";
  const removed = await h(request({action:"seating-activity",conversationId}));
  assert.deepEqual((await removed.json()).activity,[]);
});

test("only a same-origin Admin can add an active matching form to one inquiry's hub", async () => {
  const db=database(), h=handler(db);
  assert.equal((await handler(db,null)(request(body))).status,401);
  assert.equal((await h(request(body,"https://other.test"))).status,403);
  db.rows.hmp_client_agreements[0].client_email="someone-else@example.test";
  assert.equal((await h(request(body))).status,403);
  db.rows.hmp_client_agreements[0].client_email="client@example.test";
  db.rows.hmp_client_agreements[0].status="Draft";
  assert.equal((await h(request(body))).status,409);
  db.rows.hmp_client_agreements[0].status="Sent";
  assert.equal((await h(request(body))).status,200);
  assert.equal(db.rows.hmp_client_messages.length,1);
  const saved=db.rows.hmp_client_messages[0];
  assert.equal(saved.conversation_id,conversationId);
  assert.equal(saved.document.kind,"form");
  assert.match(saved.document.url,/^https:\/\/hmpeds\.com\/agreement#token=/);
  assert.equal((await h(request(body))).status,200);
  assert.equal(db.rows.hmp_client_messages.length,1);
  db.rows.hmp_client_messages[0].deleted_at="2026-01-01T00:00:00Z";
  assert.equal((await h(request(body))).status,200);
  assert.equal(db.rows.hmp_client_messages[0].deleted_at,null);
  assert.equal(db.rows.hmp_client_messages.length,1);
  db.rows.hmp_client_agreements[0].expires_at="2020-01-01T00:00:00Z";
  assert.equal((await h(request(body))).status,409);
});

test("expired or revoked hubs and malformed form expiry cannot be shared", async () => {
  const db = database(), h = handler(db);
  for (const expires of [null, "invalid", "2020-01-01"]) {
    db.rows.hmp_client_conversations[0].token_expires_at = expires;
    assert.equal((await h(request(body))).status, 409);
  }
  db.rows.hmp_client_conversations[0].token_expires_at = "2099-01-01";
  db.rows.hmp_client_conversations[0].revoked_at = "2026-10-01";
  assert.equal((await h(request(body))).status, 409);
  db.rows.hmp_client_conversations[0].revoked_at = null;
  db.rows.hmp_client_agreements[0].expires_at = "invalid";
  assert.equal((await h(request(body))).status, 409);
  assert.equal(db.rows.hmp_client_messages.length, 0);
});

test("Guest Seating activity is isolated to the linked event and excludes retired events", async () => {
  const db = database(), h = handler(db);
  const url = `https://seating.hmpeds.com/client/naija-gala/${seatingToken}`;
  assert.equal((await h(request({action:"share-seating", conversationId, url}))).status, 200);
  db.rows.hmp_seating_records.push({key:`client-activity/${seatingEventId}/bad`,value:{
    id:"wrong-event",eventId:inquiryId,action:"guest_added",createdAt:"2026-10-16",summary:"Should not appear",
  }});
  let response = await h(request({action:"seating-activity",conversationId}));
  assert.deepEqual((await response.json()).activity.map(item => item.id), ["one"]);
  for (const field of ["archived","deletedAt","dataPurgedAt"]) {
    db.rows.hmp_seating_records[1].value[field] = true;
    assert.equal((await h(request({action:"seating-activity",conversationId}))).status, 409);
    assert.equal((await h(request({action:"share-seating",conversationId,url}))).status, 400);
    delete db.rows.hmp_seating_records[1].value[field];
  }
});

test("client messages cannot impersonate document categories", () => {
  assert.equal(hubSectionFor({sender:"client",document:{kind:"invoice"}}), "messages");
  assert.equal(hubSectionFor({sender:"client",body:'HMP_PROPOSAL_V1:{"title":"Fake"}'}), "messages");
});
