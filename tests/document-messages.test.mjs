import test from "node:test";
import assert from "node:assert/strict";
import {createSendInvoiceHandler} from "../netlify/functions/hmp-send-invoice.mts";
import {createSendContractHandler} from "../netlify/functions/hmp-send-contract.mts";
import {createConversationHandler} from "../netlify/functions/hmp-conversation.mts";
import {createMessagesHandler} from "../netlify/functions/hmp-messages.mts";
import {documentSnapshot,prepareDocumentConversation} from "../netlify/functions/_document-messages.mts";
import {tokenHash} from "../netlify/functions/_conversation-security.mts";
const settings={RESEND_API_KEY:"test",HMP_INVOICE_FROM_EMAIL:"sender@example.test",SUPABASE_SERVICE_ROLE_KEY:"test-secret",HMP_ADMIN_EMAILS:"admin@example.test"};
globalThis.Netlify={env:{get:key=>settings[key]}};
const id="11111111-1111-4111-8111-111111111111",inquiryId="22222222-2222-4222-8222-222222222222",conversationId="33333333-3333-4333-8333-333333333333",requestId="44444444-4444-4444-8444-444444444444";
const token="a".repeat(43);
const record={id,inquiry_id:inquiryId,client_name:"Test <Client>",client_email:"client@example.test",invoice_number:"HMP-101",contract_number:"HMP-C-101",event_date:"2026-10-01",event_name:"Test Event",items:[{description:"Service\nDetails",quantity:1,rate:900,amount:900}],total:900,total_amount:900,scope_of_work:"Services\nMore details",status:"Draft",billing_address:"PRIVATE",created_by:"admin-only",email_message_id:"private-id"};
function database(){
  const rows={hmp_admin_invoices:[structuredClone(record)],hmp_admin_contracts:[structuredClone(record)],hmp_admin_inquiries:[{submission_id:inquiryId,email:record.client_email,client_name:record.client_name,celebration_date:record.event_date}],hmp_client_conversations:[{id:conversationId,inquiry_id:inquiryId,token_nonce:"nonce",access_token_hash:tokenHash(token),token_expires_at:"2099-01-01",revoked_at:null}],hmp_client_messages:[]};
  return {rows,failSave:false,from(table){
    let filters=[],op="read",payload,options;
    const q={select(){return this;},order(){return this;},limit(){return this;},range(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},in(k,v){filters.push(r=>v.includes(r[k]));return this;},
      update(v){op="update";payload=v;return this;},upsert(v,o){op="upsert";payload=v;options=o;return this;},
      execute(single=false){let found=rows[table].filter(r=>filters.every(f=>f(r)));if(op==="update")found.forEach(r=>Object.assign(r,payload));
        if(op==="upsert"){const exists=rows[table].find(r=>r[options.onConflict]===payload[options.onConflict]);if(!exists)rows[table].push(structuredClone(payload));found=[exists || payload];}
        return {data:single ? found[0] || null : found,error:null};},
      single(){return Promise.resolve(this.execute(true));},maybeSingle(){return Promise.resolve(this.execute(true));},then(a,b){return Promise.resolve(this.execute()).then(a,b);}};return q;
    },async rpc(name,p){assert.equal(name,"hmp_record_sent_document");if(this.failSave)return {error:{code:"test"}};
      if(!rows.hmp_client_messages.some(m=>m.id===p.p_message_id))rows.hmp_client_messages.push({id:p.p_message_id,conversation_id:p.p_conversation_id,sender:"admin",body:"Document sent",document:structuredClone(p.p_snapshot),email_notified_at:new Date().toISOString(),created_at:new Date().toISOString()});
      return {error:null};
    }};
}
const req=(body={id,requestId},origin="https://hmpeds.com")=>new Request("https://hmpeds.com/api/send",{method:"POST",headers:{Origin:origin},body:JSON.stringify(body)});
for(const [kind,factory] of [["invoice",createSendInvoiceHandler],["contract",createSendContractHandler]]) {
  test(`${kind} sends a private link and immutable copy visible to both participants; retry adds no duplicate`,async()=>{
    const db=database(),emails=[];
    const h=factory({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db,fetchFn:async(_,o)=>{emails.push(o);return Response.json({id:"mail-id"});}});
    assert.equal((await h(req())).status,200);assert.equal((await h(req())).status,200);
    assert.equal(db.rows.hmp_client_messages.length,1);
    const copy=db.rows.hmp_client_messages[0].document;assert.equal(copy.kind,kind);assert.ok(!("billing_address" in copy));assert.ok(!("created_by" in copy));
    db.rows[`hmp_admin_${kind}s`][0].total=1234;assert.equal(copy.total || copy.total_amount,900);
    assert.equal(emails[0].headers["Idempotency-Key"],emails[1].headers["Idempotency-Key"]);
    const mail=JSON.parse(emails[0].body);assert.deepEqual(mail.to,[record.client_email]);assert.match(mail.html,/conversation#token=/);
    const client=createConversationHandler({databaseFactory:()=>db});
    const clientData=await (await client(new Request("https://hmpeds.com/api/hmp-conversation",{headers:{Authorization:`Bearer ${token}`}}))).json();
    assert.deepEqual(clientData.messages[0].document,copy);
    assert.equal((await client(new Request("https://hmpeds.com/api/hmp-conversation",{headers:{Authorization:`Bearer ${"b".repeat(43)}`}}))).status,401);
    const admin=createMessagesHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db});
    const adminData=await (await admin(new Request("https://hmpeds.com/api/hmp-messages"))).json();assert.deepEqual(adminData.threads[0].messages[0].document,copy);
  });
  test(`${kind} failures and recipient mismatches cannot expose a document or falsely mark it sent`,async()=>{
    const db=database();let calls=0,failEmail=true;
    const h=factory({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db,fetchFn:async()=>{calls++;return Response.json({}, {status:failEmail ? 503 : 200});}});
    assert.equal((await h(req())).status,502);assert.equal(db.rows.hmp_client_messages.length,0);
    assert.equal((await h(req({id,requestId,recipient:"other@example.test"}))).status,409);
    db.rows.hmp_admin_inquiries[0].email="other@example.test";assert.equal((await h(req())).status,409);assert.equal(calls,1);
    db.rows.hmp_admin_inquiries[0].email=record.client_email;db.rows.hmp_client_conversations[0].revoked_at="2026-01-01";
    assert.equal((await h(req())).status,409);assert.equal(calls,1);db.rows.hmp_client_conversations[0].revoked_at=null;
    assert.equal((await h(req(undefined,"https://evil.test"))).status,403);
    const unauthorized=factory({getUserFn:async()=>null,databaseFactory:()=>db});assert.equal((await unauthorized(req())).status,401);
    failEmail=false;db.failSave=true;const response=await h(req());assert.equal(response.status,502);assert.match((await response.json()).error,/Email sent.*Retry/);assert.equal(db.rows.hmp_client_messages.length,0);
    db.failSave=false;assert.equal((await h(req())).status,200);assert.equal(db.rows.hmp_client_messages.length,1);
  });
}
test("standalone documents reuse the exact email/event inquiry or safely create a linked conversation",async()=>{
  const db=database(),unlinked={...record,inquiry_id:null};
  const first=await prepareDocumentConversation(db,"invoice",unlinked,record.client_email,"admin");assert.equal(first.conversation.id,conversationId);
  db.rows.hmp_admin_inquiries=[];db.rows.hmp_client_conversations=[];
  await prepareDocumentConversation(db,"invoice",unlinked,record.client_email,"admin");
  await prepareDocumentConversation(db,"invoice",unlinked,record.client_email,"admin");
  assert.equal(db.rows.hmp_admin_inquiries.length,1);assert.equal(db.rows.hmp_client_conversations.length,1);
  assert.equal(db.rows.hmp_admin_invoices[0].inquiry_id,db.rows.hmp_admin_inquiries[0].submission_id);
});
test("snapshots contain only client-facing document fields, not arbitrary record or line-item metadata",()=>{
  const snapshot=documentSnapshot("invoice",{...record,items:[{...record.items[0],secret:"hidden"}]});
  assert.ok(!JSON.stringify(snapshot).includes("hidden"));assert.ok(!JSON.stringify(snapshot).includes("PRIVATE"));
  assert.equal(snapshot.items[0].description,"Service\nDetails");
});
