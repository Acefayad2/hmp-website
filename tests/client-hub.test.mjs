import test from "node:test";
import assert from "node:assert/strict";
import { hubMessages, hubSectionFor } from "../client-hub.js";
import { createMessagesHandler } from "../netlify/functions/hmp-messages.mts";

const conversationId = "11111111-1111-4111-8111-111111111111";
const inquiryId = "22222222-2222-4222-8222-222222222222";
const formId = "33333333-3333-4333-8333-333333333333";
const settings = { HMP_ADMIN_EMAILS:"admin@example.test", SUPABASE_SERVICE_ROLE_KEY:"test-secret" };
globalThis.Netlify = { env:{get:key => settings[key]} };

function database() {
  const rows = {
    hmp_client_conversations:[{id:conversationId,inquiry_id:inquiryId,revoked_at:null,token_expires_at:"2099-01-01T00:00:00Z"}],
    hmp_admin_inquiries:[{submission_id:inquiryId,email:"client@example.test",celebration_date:"2026-10-20"}],
    hmp_client_agreements:[{id:formId,client_email:"client@example.test",status:"Sent",expires_at:"2099-01-01T00:00:00Z",token_nonce:"test-nonce",snapshot:{title:"Event details"}}],
    hmp_client_messages:[],
  };
  return {rows,from(table) {
    let filters=[],operation="read",value;
    const query = {
      select(){return this;},eq(key,expected){filters.push(row=>row[key]===expected);return this;},
      insert(payload){operation="insert";value=payload;return this;},
      update(payload){operation="update";value=payload;return this;},
      run(single=false){
        let found=rows[table].filter(row=>filters.every(filter=>filter(row)));
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
  const url = `https://seating.hmpeds.com/client/naija-gala/${"a".repeat(48)}`;
  const seatBody = {action:"share-seating",conversationId,url};
  let eventDate = "2026-10-20";
  const fetchFn = async (requested, options) => {
    assert.match(requested, /^https:\/\/seating\.hmpeds\.com\/api\/seating\/client\/[a-z0-9-]+\/[a-f0-9]{48}$/);
    assert.equal(options.redirect, "error");
    return Response.json({event:{name:"Naija Gala",date:eventDate}});
  };
  const h = handler(db,undefined,fetchFn);
  assert.equal((await handler(db,null,fetchFn)(request(seatBody))).status,401);
  assert.equal((await h(request(seatBody,"https://other.test"))).status,403);
  assert.equal((await h(request({...seatBody,url:"https://attacker.test/client/naija-gala/"+"a".repeat(48)}))).status,400);
  eventDate = "2026-10-21";
  assert.equal((await h(request(seatBody))).status,409);
  eventDate = "2026-10-20";
  assert.equal((await h(request(seatBody))).status,200);
  assert.equal(db.rows.hmp_client_messages[0].document.kind,"seating");
  assert.equal(db.rows.hmp_client_messages[0].document.url,url);
  assert.equal((await h(request(seatBody))).status,200);
  assert.equal(db.rows.hmp_client_messages.length,1);
  assert.equal((await h(request({...seatBody,url:`https://seating.hmpeds.com/client/other/${"b".repeat(48)}`}))).status,409);
  const activityHandler = handler(db,undefined,async (requested, options) => {
    assert.equal(requested, `${url.replace("/client/", "/api/seating/client/")}/activity`);
    assert.equal(options.redirect,"error");
    return Response.json({activity:[{id:"1",kind:"guest_added",detail:"Sam Doe · Table 2",at:"2026-10-20T12:00:00Z"}]});
  });
  const activity = await activityHandler(request({action:"seating-activity",conversationId}));
  assert.equal(activity.status,200);
  assert.deepEqual((await activity.json()).activity.map((item) => item.kind),["guest_added"]);
  db.rows.hmp_client_messages[0].deleted_at="2026-10-20T13:00:00Z";
  const removed = await activityHandler(request({action:"seating-activity",conversationId}));
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
