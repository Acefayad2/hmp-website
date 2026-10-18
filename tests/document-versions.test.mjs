import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {latestDocumentRows,latestPublishedDocuments} from "../document-versions.mjs";
import {serializeProposal} from "../proposal-ui.js";
import {createDocumentVersionsHandler} from "../netlify/functions/hmp-document-versions.mts";

const root="11111111-1111-4111-8111-111111111111";
const idFor=n=>`22222222-2222-4222-8222-${String(n).padStart(12,"0")}`;
globalThis.Netlify={env:{get:key=>({HMP_ADMIN_EMAILS:"admin@example.test",SUPABASE_URL:"https://example.test",SUPABASE_SERVICE_ROLE_KEY:"test-only"})[key]}};

test("client documents show only the latest explicitly shared copy and retain unrelated messages",()=>{
  const original={id:"m1",sender:"admin",createdAt:"2026-10-01",document:{kind:"invoice",id:root}};
  const latest={id:"m2",sender:"admin",createdAt:"2026-10-02",document:{kind:"invoice",id:idFor(2),revisionRootId:root}};
  const unrelated={id:"text",sender:"client",body:"A question"};
  assert.deepEqual(latestPublishedDocuments([original,unrelated]),[original,unrelated],"Creating an unshared draft cannot affect these messages");
  const input=[latest,original,unrelated];const before=structuredClone(input);
  assert.deepEqual(latestPublishedDocuments(input),[latest,unrelated]);assert.deepEqual(input,before);
  assert.deepEqual(latestPublishedDocuments([{...latest,sender:"client"},original]).map(row=>row.id),["m2","m1"],"Client text cannot supersede an admin document");
});
test("proposal revisions replace legacy messages without hiding other proposals or events",()=>{
  const body=serializeProposal({title:"QA",clientName:"Example",serviceFee:100});
  const messages=[{id:root,sender:"admin",body,created_at:"2026-10-01"},{id:idFor(2),sender:"admin",body,revision_root_id:root,created_at:"2026-10-02"},{id:"separate",sender:"admin",body,created_at:"2026-10-03"}];
  assert.deepEqual(latestPublishedDocuments(messages).map(r=>r.id),[idFor(2),"separate"]);
});
test("admin document lists group revisions without dropping stored originals",()=>{
  const rows=[{id:root,createdAt:"2026-10-01",status:"Paid"},{id:idFor(2),revisionRootId:root,createdAt:"2026-10-02",status:"Draft"},{id:"other",createdAt:"2026-10-03"}];
  assert.deepEqual(latestDocumentRows(rows).map(r=>r.id),[idFor(2),"other"]);assert.equal(rows.length,3);
});
function database(){
  const versions=Array.from({length:7},(_,i)=>({kind:"invoice",document_id:i?idFor(i+1):root,root_id:root,version:i+1,created_at:`2026-10-${String(i+1).padStart(2,"0")}`}));
  const invoices=versions.map(v=>({id:v.document_id,invoice_number:`QA-R${v.version}`,status:"Paid",total:100,client_email:"qa@example.test",token_hash:"must-not-leak"}));
  return {calls:[],from(table){
    const rows=table==="hmp_document_versions"?versions:table==="hmp_admin_invoices"?invoices:[];let filters=[],start=0,end=Infinity,sort=false;
    const q={select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},order(){sort=true;return this;},range(a,b){start=a;end=b;return this;},
      result(one=false){let found=rows.filter(r=>filters.every(f=>f(r)));if(sort)found=found.toSorted((a,b)=>b.version-a.version);found=found.slice(start,end+1);return {data:one?found[0]||null:found,error:null};},maybeSingle(){return Promise.resolve(this.result(true));},then(resolve,reject){return Promise.resolve(this.result()).then(resolve,reject);}};return q;
  },async rpc(name,args){this.calls.push({name,args});return {data:args.p_new_id,error:null};}};
}
const req=(method="GET",body)=>new Request(`https://hmpeds.com/api/hmp-document-versions?kind=invoice&id=${root}`,{method,headers:{Origin:"https://hmpeds.com"},...(body?{body:JSON.stringify(body)}:{})});
test("version endpoint requires admin authorization and same-origin creation",async()=>{
  const db=database();
  const denied=createDocumentVersionsHandler({getUserFn:async()=>({email:"client@example.test"}),databaseFactory:()=>db});
  assert.equal((await denied(req())).status,401);
  const h=createDocumentVersionsHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db});
  assert.equal((await h(new Request(req("POST",{}),{headers:{Origin:"https://other.test"}}))).status,403);
  assert.equal((await h(req("POST",{kind:"constructor",id:root,requestId:idFor(8)}))).status,400);
  assert.equal((await h(req("POST",{kind:"invoice",id:root}))).status,400);
  assert.equal(db.calls.length,0);
});
test("history returns five versions then private archive pages and never access tokens",async()=>{
  const db=database(),h=createDocumentVersionsHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db});
  const first=await (await h(req())).json();
  assert.deepEqual(first.versions.map(v=>v.version),[7,6,5,4,3]);assert.equal(first.hasMore,true);
  const archive=await (await h(new Request(req().url+"&offset=5"))).json();
  assert.deepEqual(archive.versions.map(v=>v.version),[2,1]);assert.equal(archive.hasMore,false);
  assert.doesNotMatch(JSON.stringify(first),/must-not-leak|token_hash/);
});
test("revision endpoint uses fresh access token and caller-owned idempotency request ID",async()=>{
  const db=database(),h=createDocumentVersionsHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db});
  const response=await h(req("POST",{kind:"invoice",id:root,requestId:idFor(8)}));
  assert.equal(response.status,201);assert.equal((await response.json()).id,idFor(8));
  assert.equal(db.calls[0].name,"hmp_create_document_revision");assert.equal(db.calls[0].args.p_actor,"admin@example.test");
  assert.equal(db.calls[0].args.p_token_hash.length,64);assert.ok(db.calls[0].args.p_nonce.length>=20);
});
test("public build ships the version helper and editors expose history with no automatic send",()=>{
  const build=readFileSync(new URL("../scripts/build-admin.mjs",import.meta.url),"utf8");assert.match(build,/"document-versions.mjs"/);
  const ui=readFileSync(new URL("../src/document-versions.js",import.meta.url),"utf8");
  assert.match(ui,/Show older archived versions/);assert.match(ui,/Restore as new draft/);assert.doesNotMatch(ui,/hmp-messages|\/send/);
});
