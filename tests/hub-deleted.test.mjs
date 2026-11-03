import test from 'node:test';
import assert from 'node:assert/strict';
import {createMessagesHandler} from '../netlify/functions/hmp-messages.mts';
import {createHubPurgeHandler} from '../netlify/functions/purge-deleted-hubs.mts';
const id='11111111-1111-4111-8111-111111111111';
globalThis.Netlify={env:{get:key=>key==='HMP_ADMIN_EMAILS'?'admin@example.test':''}};
const req=(action,origin='https://hmpeds.com')=>new Request('https://hmpeds.com/api/hmp-messages',{method:'POST',headers:{origin},body:JSON.stringify({action,conversationId:id})});
test('delete and restore use soft lifecycle RPC, require Admin and same origin',async()=>{
 const calls=[];let result={data:true};
 const databaseFactory=()=>({rpc:async(name,args)=>{calls.push([name,args]);return result;}});
 const handler=createMessagesHandler({databaseFactory,getUserFn:async()=>({email:'admin@example.test'})});
 assert.equal((await createMessagesHandler({databaseFactory,getUserFn:async()=>null})(req('delete'))).status,401);
 assert.equal((await handler(req('delete','https://evil.test'))).status,403);
 for(const action of ['delete','restore-deleted'])assert.equal((await handler(req(action))).status,200);
 assert.deepEqual(calls.map(c=>c[1].p_deleted),[true,false]);assert.ok(calls.every(c=>c[0]==='hmp_set_hub_deleted'));
 result={error:{code:'expired'}};assert.equal((await handler(req('restore-deleted'))).status,409);
});
test('deleted hub mutations fail before email, upload, or link generation',async()=>{
 const databaseFactory=()=>({from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{deleted_at:'2026-11-01'}})})});
 const handler=createMessagesHandler({databaseFactory,getUserFn:async()=>({email:'admin@example.test'})});
 for(const action of ['send','prepare-upload','set-link-expiration','archive','restore','share-form'])assert.equal((await handler(req(action))).status,409);
});
test('purge retries file failures without deleting the conversation or touching financial tables',async()=>{
 const calls=[];let fail=true;
 const databaseFactory=()=>({
  from(table){calls.push(table);let deleting=false;return {
   select(){return this;},lte(){return this;},order(){return this;},eq(){return this;},not(){return this;},
   limit:async()=>({data:[{id}]}),update(){return this;},maybeSingle:async()=>({data:{id}}),
   range:async()=>({data:[{path:'conversation/file'}]}),delete(){deleting=true;return this;},
   then(resolve){if(deleting)calls.push('deleted');return Promise.resolve({}).then(resolve);}
  };},
  storage:{from:()=>({remove:async()=>({error:fail?{code:'offline'}:null})})}
 });
 const handler=createHubPurgeHandler({databaseFactory,now:()=>Date.parse('2026-11-03')});
 await assert.rejects(handler(),/retry/);assert.ok(!calls.includes('deleted'));
 fail=false;assert.equal((await(await handler()).json()).purged,1);assert.ok(calls.includes('deleted'));
 assert.ok(calls.every(c=>['hmp_client_conversations','hmp_conversation_attachment_uploads','deleted'].includes(c)));
});
