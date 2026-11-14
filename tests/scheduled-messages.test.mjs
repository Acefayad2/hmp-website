import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduledMessagesHandler} from '../netlify/functions/hmp-scheduled-messages.mts';
import {deliverScheduledMessages} from '../netlify/functions/hmp-deliver-scheduled-messages.mts';

globalThis.Netlify={env:{get:key=>({HMP_ADMIN_EMAILS:'admin@example.test',SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test'}[key])}};
const hubId='11111111-1111-4111-8111-111111111111';
const inquiryId='22222222-2222-4222-8222-222222222222';
const request=(body,origin='https://hmpeds.com')=>new Request('https://hmpeds.com/api/hmp-scheduled-messages',{method:'POST',headers:{Origin:origin},body:JSON.stringify(body)});

test('scheduled sends require Admin authentication and a same-origin request',async()=>{
  const inaccessible=()=>{throw Error('database must not be touched')};
  const anonymous=createScheduledMessagesHandler({getUserFn:async()=>null,databaseFactory:inaccessible});
  assert.equal((await anonymous(request({}))).status,401);
  const admin=createScheduledMessagesHandler({getUserFn:async()=>({email:'admin@example.test'}),databaseFactory:inaccessible});
  assert.equal((await admin(request({},'https://evil.test'))).status,403);
});

test('schedule saves a future email with the server-selected recipient and keeps it out of the conversation',async()=>{
  const saved=[];
  const hub={id:hubId,inquiry_id:inquiryId,token_expires_at:new Date(Date.now()+30*86400_000).toISOString()};
  const inquiry={email:'client@example.test',phone:'3015550111',status:'active'};
  const db={from(table){return {
    select(){return this},eq(){return this},
    maybeSingle(){return Promise.resolve({data:table==='hmp_client_conversations'?hub:inquiry,error:null})},
    insert(row){assert.equal(table,'hmp_scheduled_client_messages');saved.push(row);return Promise.resolve({error:null})},
  }}};
  const handler=createScheduledMessagesHandler({getUserFn:async()=>({email:'admin@example.test'}),databaseFactory:()=>db});
  const response=await handler(request({action:'schedule',conversationId:hubId,channel:'email',message:'Hello client',recipient:'attacker@example.test',scheduledAt:new Date(Date.now()+3600_000).toISOString()}));
  assert.equal(response.status,200);assert.equal(saved.length,1);
  assert.equal(saved[0].recipient,'client@example.test');assert.equal(saved[0].channel,'email');
});

test('dispatcher refuses an expired Client Hub before sending an external message',async()=>{
  const row={id:'33333333-3333-4333-8333-333333333333',conversation_id:hubId,channel:'email',recipient:'client@example.test',body:'Hello'};
  const changes=[];
  const db={rpc:async()=>({data:[row],error:null}),from(table){return {
    select(){return this},eq(){return this},
    maybeSingle(){return Promise.resolve({data:{id:hubId,token_expires_at:'2000-01-01T00:00:00Z'},error:null})},
    update(value){changes.push(value);return this},
    then(resolve){return Promise.resolve({error:null}).then(resolve)},
  }}};
  const result=await deliverScheduledMessages(db,async()=>{throw Error('must not send')});
  assert.equal(result.failed,1);assert.equal(changes[0].status,'failed');
});
