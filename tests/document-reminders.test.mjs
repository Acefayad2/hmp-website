import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleDates,documentEligible,Ineligible} from '../netlify/functions/_document-reminders.mts';
import {deliverDocumentReminders} from '../netlify/functions/hmp-deliver-document-reminders.mts';
import {createRemindersHandler} from '../netlify/functions/hmp-document-reminders.mts';
globalThis.Netlify={env:{get:key=>({RESEND_API_KEY:'test',HMP_COMMUNICATION_EMAIL:'hmp@example.test',HMP_ADMIN_EMAILS:'admin@example.test'}[key])}};
const id='11111111-1111-4111-8111-111111111111';
test('schedule rejects past, invalid, excessive, and out-of-year reminders',()=>{
 const now=Date.parse('2026-11-04T12:00:00Z');
 assert.deepEqual(scheduleDates('2026-11-05T12:00:00Z',2,7,now),['2026-11-05T12:00:00.000Z','2026-11-12T12:00:00.000Z']);
 for(const args of [['bad',1,7],['2026-11-04T12:00:00Z',1,7],['2026-11-05T12:00:00Z',13,7],['2026-11-05T12:00:00Z',12,90],['2026-11-05T12:00:00Z',1,0]])assert.throws(()=>scheduleDates(...args,now),Ineligible);
});
test('completed, paid, void, expired, deleted and draft records never qualify',()=>{
 for(const kind of ['invoice','contract','form'])for(const status of ['Paid','Signed','Completed','Void','Draft'])assert.equal(documentEligible(kind,{status}),false);
 assert.equal(documentEligible('invoice',{status:'Partially paid'}),true);
 assert.equal(documentEligible('form',{status:'Sent',expires_at:'2000-01-01'}),false);
 assert.equal(documentEligible('invoice',{status:'Sent',deleted_at:'2026-01-01'}),false);
});
function database(payload){const updates=[],notices=[];return {updates,notices,rpc:async()=>({data:[{id,kind:'invoice',document_id:id,conversation_id:id,attempts:1,email_payload:payload}]}),from(table){return {update(v){updates.push(v);return this;},upsert(v){notices.push(v);return this;},eq(){return this;},lt(){return this;},then(resolve){return Promise.resolve({error:null}).then(resolve);}};}};}
const context=async()=>({email:'client@example.test',hub:{id},body:'Please pay <Invoice>',url:'https://hmpeds.com/conversation#token=test'});
test('email and portal delivery use stable idempotency with escaped content',async()=>{
 const db=database();let options;
 assert.equal((await deliverDocumentReminders(db,async(_,o)=>{options=o;return new Response();},context)).accepted,1);
 assert.equal(options.headers['Idempotency-Key'],`hmp-document-reminder/${id}`);
 assert.match(JSON.parse(options.body).html,/&lt;Invoice&gt;/);
 assert.equal(db.notices[0].id,id);assert.equal(db.updates.at(-1).status,'sent');
});
test('provider errors retry, while completed records cancel before any external send',async()=>{
 let calls=0;const db=database();
 await deliverDocumentReminders(db,async()=>{calls++;return new Response('',{status:429});},context);
 assert.equal(calls,1);assert.match(db.updates.at(-1).detail,/retry/);
 const stopped=database();await deliverDocumentReminders(stopped,async()=>{throw Error('must not send');},async()=>{throw new Ineligible('Already paid');});
 assert.equal(stopped.notices.length,0);assert.equal(stopped.updates.at(-1).status,'cancelled');
});
test('retry freezes payload and stops when recipient changes',async()=>{
 const payload={to:['client@example.test'],subject:'Original',html:'Original'};let sent;
 await deliverDocumentReminders(database(payload),async(_,o)=>{sent=JSON.parse(o.body);return new Response();},context);assert.deepEqual(sent,payload);
 const db=database({...payload,to:['other@example.test']});await deliverDocumentReminders(db,async()=>{throw Error('must not send');},context);assert.equal(db.updates.at(-1).status,'cancelled');
});
test('a completion between portal notice and email cancels the email',async()=>{
 let checks=0;const db=database();await deliverDocumentReminders(db,async()=>{throw Error('must not send');},async()=>{if(++checks===2)throw new Ineligible('Already paid');return context();});assert.equal(db.updates.at(-1).status,'cancelled');
});
test('Admin auth and same-origin validation run before touching database',async()=>{
 const factory=()=>{throw Error('must not query');};
 assert.equal((await createRemindersHandler({getUserFn:async()=>null,databaseFactory:factory})(new Request('https://hmpeds.com/api/hmp-document-reminders'))).status,401);
 const handler=createRemindersHandler({getUserFn:async()=>({email:'admin@example.test'}),databaseFactory:factory});
 assert.equal((await handler(new Request('https://hmpeds.com/api/hmp-document-reminders',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}))).status,403);
});
