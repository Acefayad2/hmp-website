import test from "node:test";
import assert from "node:assert/strict";
import {createMessagesHandler} from "../netlify/functions/hmp-messages.mts";
import {createConversationHandler} from "../netlify/functions/hmp-conversation.mts";
import {clientAccessNotice} from "../client-hub.js";
const id="11111111-1111-4111-8111-111111111111";
globalThis.Netlify={env:{get:key=>key==="HMP_ADMIN_EMAILS"?"admin@example.test":""}};
const request=(action,origin="https://hmpeds.com",conversationId=id)=>new Request("https://hmpeds.com/api/hmp-messages",{method:"POST",headers:{Origin:origin},body:JSON.stringify({action,conversationId})});

test("hub archive and restore require same-origin Admin and report RPC failure",async()=>{
  const calls=[];
  let result={data:true,error:null};
  const databaseFactory=()=>({rpc:async(name,args)=>{calls.push({name,args});return result;}});
  const handler=createMessagesHandler({databaseFactory,getUserFn:async()=>({email:"admin@example.test"})});
  const unauthorized=createMessagesHandler({databaseFactory,getUserFn:async()=>null});
  assert.equal((await unauthorized(request("archive"))).status,401);
  assert.equal((await handler(request("archive","https://other.example"))).status,403);
  assert.equal((await handler(request("archive","https://hmpeds.com","invalid"))).status,400);
  assert.equal(calls.length,0);
  assert.equal((await handler(request("archive"))).status,200);
  assert.equal((await handler(request("restore"))).status,200);
  assert.deepEqual(calls,[
    {name:"hmp_set_hub_archived",args:{p_id:id,p_archived:true}},
    {name:"hmp_set_hub_archived",args:{p_id:id,p_archived:false}},
  ]);
  result={data:false,error:null};assert.equal((await handler(request("archive"))).status,404);
  result={data:null,error:{code:"test"}};assert.equal((await handler(request("restore"))).status,502);
});
test("archived hub rejects existing bearer token before PIN checks or client data access",async()=>{
  const tables=[];
  const handler=createConversationHandler({databaseFactory:()=>({from(name){tables.push(name);return {
    select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id,revoked_at:"2026-10-30",token_expires_at:"2099-01-01"}}),
  };}})});
  for(const method of ["GET","POST"]){
    const response=await handler(new Request("https://hmpeds.com/api/hmp-conversation",{method,headers:{Authorization:"Bearer "+"a".repeat(43)}}));
    assert.equal(response.status,401);
  }
  assert.deepEqual(tables,["hmp_client_conversations","hmp_client_conversations"]);
  assert.match(clientAccessNotice({archivedAt:"2026-10-30"}),/Archived — client access.*disabled/);
});
