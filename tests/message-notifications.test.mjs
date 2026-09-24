import test from "node:test";
import assert from "node:assert/strict";
import { createMessagesHandler, notifyStoredMessage, sendReplyNotification } from "../netlify/functions/hmp-messages.mts";
const settings={RESEND_API_KEY:"test-only",HMP_INQUIRY_FROM_EMAIL:"sender@example.test",SUPABASE_SERVICE_ROLE_KEY:"test-key",HMP_ADMIN_EMAILS:"admin@example.test"};
globalThis.Netlify={env:{get:key=>settings[key]}};
const conversationId="11111111-1111-4111-8111-111111111111", messageId="22222222-2222-4222-8222-222222222222", inquiryId="33333333-3333-4333-8333-333333333333";
const conversation={id:conversationId,inquiry_id:inquiryId,token_nonce:"test-nonce",token_expires_at:"2099-01-01T00:00:00Z",revoked_at:null};
const inquiry={submission_id:inquiryId,client_name:"Test <Client>",email:"CLIENT@example.test"};
function fakeDatabase(messages=[]) {
  return {from(table){
    const rows=table==="hmp_client_messages" ? messages : table==="hmp_client_conversations" ? [conversation] : [inquiry];
    let filters=[],op="read",payload;
    const q={select(){return this;},order(){return this;},limit(){return this;},
      eq(k,v){filters.push(row=>row[k]===v);return this;},
      is(k,v){filters.push(row=>(row[k] ?? null)===v);return this;},
      in(k,v){filters.push(row=>v.includes(row[k]));return this;},
      insert(v){op="insert";payload=v;return this;},update(v){op="update";payload=v;return this;},
      execute(single=false){
        let found=rows.filter(row=>filters.every(f=>f(row)));
        if(op==="insert"){
          if(rows.some(row=>row.id===payload.id))return {data:null,error:{code:"23505"}};
          const row={...payload,created_at:new Date().toISOString(),email_notified_at:null};rows.push(row);found=[row];
        }
        if(op==="update")found.forEach(row=>Object.assign(row,payload));
        return {data:single ? found[0] || null : found,error:null};
      },single(){return Promise.resolve(this.execute(true));},maybeSingle(){return Promise.resolve(this.execute(true));},
      then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject);},
    };return q;
  }};
}
const request=(body,origin="https://hmpeds.com")=>new Request("https://hmpeds.com/api/hmp-messages",{method:"POST",headers:{Origin:origin},body:JSON.stringify(body)});
const sendBody={action:"send",conversationId,requestId:messageId,message:"Hello client",attachments:[]};
const handler=(db,fetchFn,user={email:"admin@example.test"})=>createMessagesHandler({getUserFn:async()=>user,databaseFactory:()=>db,fetchFn});

test("every saved admin reply emails the server-selected client using a private link and a stable message key",async()=>{
  const messages=[],emails=[],h=handler(fakeDatabase(messages),async(_,options)=>{emails.push(options);return new Response("{}");});
  const response=await h(request({...sendBody,email:"attacker@example.test"}));
  assert.equal(response.status,200);assert.equal((await response.json()).notified,true);
  assert.equal(messages.length,1);assert.ok(messages[0].email_notified_at);assert.equal(messages[0].email_notification_error,null);
  const mail=JSON.parse(emails[0].body);
  assert.deepEqual(mail.to,["client@example.test"]);assert.match(mail.html,/Test &lt;Client&gt;/);
  assert.match(mail.html,/conversation#token=/);assert.match(mail.html,/Connect with an Event Specialist/);
  await h(request(sendBody));assert.equal(emails.length,1);assert.equal(messages.length,1);
});
test("email failure keeps the message and persistent warning; retry sends only email and clears the warning",async()=>{
  const messages=[],emails=[];let fail=true;
  const h=handler(fakeDatabase(messages),async(_,options)=>{emails.push(options);return new Response("{}",{status:fail ? 503 : 200});});
  const saved=await (await h(request(sendBody))).json();
  assert.equal(saved.ok,true);assert.equal(saved.notified,false);assert.match(saved.notificationError,/Retry/);
  assert.ok(messages[0].email_notification_error);fail=false;
  const retry=await (await h(request({action:"retry-notification",conversationId,messageId}))).json();
  assert.equal(retry.notified,true);assert.equal(messages.length,1);assert.equal(messages[0].email_notification_error,null);
  assert.equal(emails[0].headers["Idempotency-Key"],emails[1].headers["Idempotency-Key"]);
  const result=await h(new Request("https://hmpeds.com/api/hmp-messages"));
  assert.ok((await result.json()).threads[0].messages[0].emailNotifiedAt);
});
test("missing setup, bad email, inactive links, and network failures report failure without losing the message",async()=>{
  const message={id:messageId,conversation_id:conversationId,sender:"admin",body:"Hello"};
  let calls=0;
  const fetchFn=async()=>{calls++;throw new Error("network error");};
  for(const [contact,thread,pattern] of [
    [{...inquiry,email:"invalid"},conversation,/valid email/],
    [inquiry,{...conversation,revoked_at:"2026-01-01"},/inactive/],
    [inquiry,{...conversation,token_expires_at:"2000-01-01"},/inactive/],
    [null,conversation,/details/],
  ]){
    const result=await notifyStoredMessage(fakeDatabase([message]),contact,thread,message,fetchFn);
    assert.equal(result.notified,false);assert.match(result.notificationError,pattern);
  }
  assert.equal(calls,0);
  const key=settings.RESEND_API_KEY;delete settings.RESEND_API_KEY;
  try {assert.match((await notifyStoredMessage(fakeDatabase([message]),inquiry,conversation,message,fetchFn)).notificationError,/not configured/);}
  finally{settings.RESEND_API_KEY=key;}
  assert.match((await notifyStoredMessage(fakeDatabase([message]),inquiry,conversation,message,fetchFn)).notificationError,/could not be confirmed/);
});
test("email-only retries require admin authorization and cannot target client messages or another conversation",async()=>{
  const messages=[{id:messageId,conversation_id:conversationId,sender:"client",body:"Hi"}];
  let sends=0;const fetchFn=async()=>{sends++;return new Response("{}");};
  const body={action:"retry-notification",conversationId,messageId};
  assert.equal((await handler(fakeDatabase(messages),fetchFn,null)(request(body))).status,401);
  const h=handler(fakeDatabase(messages),fetchFn);
  assert.equal((await h(request(body,"https://evil.test"))).status,403);
  assert.equal((await h(request(body))).status,404);
  messages[0].sender="admin";messages[0].conversation_id=inquiryId;
  assert.equal((await h(request(body))).status,404);assert.equal(sends,0);
});
test("proposals and attachment-only messages use the same notification path",async()=>{
  const emails=[];
  const fetchFn=async(_,options)=>{emails.push(JSON.parse(options.body));return new Response("{}");};
  await sendReplyNotification(inquiry,conversation,messageId,true,fetchFn);
  assert.match(emails[0].subject,/proposal/);
  const message={id:messageId,conversation_id:conversationId,sender:"admin",body:"",attachments:[{name:"video.mp4"}]};
  assert.equal((await notifyStoredMessage(fakeDatabase([message]),inquiry,conversation,message,fetchFn)).notified,true);
  assert.match(emails[1].subject,/replied/);
});
