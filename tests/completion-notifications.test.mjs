import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deliverCompletionAlerts} from "../netlify/functions/hmp-completion-alerts.mts";
import {createNotificationsHandler} from "../netlify/functions/hmp-notifications.mts";
import {mountAdminNotifications} from "../src/admin-notifications.js";
const settings={RESEND_API_KEY:"test-only",HMP_COMMUNICATION_EMAIL:"eventsconcierge@hmpeds.com",HMP_ADMIN_EMAILS:"admin@example.test",SUPABASE_URL:"https://example.test",SUPABASE_SERVICE_ROLE_KEY:"test-key"};
globalThis.Netlify={env:{get:key=>settings[key]}};
const id="11111111-1111-4111-8111-111111111111";
const row={id,agreement_id:id,client_name:"<Client>",title:"<script>test</script>",kind:"agreement_signed",created_at:"2026-10-21T00:00:00Z",read_by:["another@example.test"],attempts:1,email_from:"HMP <eventsconcierge@hmpeds.com>",email_to:"eventsconcierge@hmpeds.com"};
function database(rows=[row]) {
  const updates=[],calls=[];
  return {updates,calls,rpc:async(name,args)=>{calls.push({name,args});return {data:name==="hmp_claim_completion_notifications"?rows:true,error:null};},from(table){assert.equal(table,"hmp_admin_notifications");const q={select(){return this;},order(){return this;},limit(){return this;},eq(){return this;},update(data){updates.push(data);return this;},then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};return q;}};
}
test("email alerts use stable idempotency and escaped minimal content, never signatures or private links",async()=>{
  const db=database();let payload,headers;
  assert.deepEqual(await deliverCompletionAlerts(db,async(url,options)=>{payload=JSON.parse(options.body);headers=options.headers;return Response.json({id:"accepted"});}),{processed:1,accepted:1});
  assert.deepEqual(payload.to,["eventsconcierge@hmpeds.com"]);
  assert.match(payload.html,/&lt;Client&gt;/);assert.doesNotMatch(payload.html,/<script>|token=|signatureName/);
  assert.match(payload.html,/https:\/\/hmpeds.com\/admin\?notifications=1/);
  assert.equal(headers["Idempotency-Key"],`hmp-completion/${id}`);
  assert.ok(db.updates[0].email_accepted_at);assert.equal(db.updates[0].email_error,null);
});
test("provider failures remain retryable without altering the completed document",async()=>{
  for(const send of [async()=>new Response("",{status:429}),async()=>{throw Error("network");}]) {
    const db=database();assert.deepEqual(await deliverCompletionAlerts(db,send),{processed:1,accepted:0});
    assert.ok(db.updates[0].email_error);assert.equal(db.updates[0].email_accepted_at,undefined);
  }
});
test("alerts endpoint is Admin-only, never caches or exposes email configuration or other readers",async()=>{
  let queried=false;
  const denied=createNotificationsHandler({getUserFn:async()=>({email:"client@example.test"}),databaseFactory:()=>{queried=true;}});
  const request=new Request("https://hmpeds.com/api/hmp-notifications");
  assert.equal((await denied(request)).status,401);assert.equal(queried,false);
  const handler=createNotificationsHandler({getUserFn:async()=>({email:"ADMIN@example.test"}),databaseFactory:()=>database()});
  const response=await handler(request);assert.equal(response.headers.get("Cache-Control"),"no-store");
  const body=await response.json();assert.equal(body.notifications[0].read,false);assert.equal(body.notifications[0].emailStatus,"Email queued");
  assert.doesNotMatch(JSON.stringify(body),/another@example.test|email_from|email_to|service_role/);
});
test("mark read derives the Admin identity from the session and rejects foreign origins",async()=>{
  const db=database(),handler=createNotificationsHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db});
  const request=origin=>new Request("https://hmpeds.com/api/hmp-notifications",{method:"POST",headers:{Origin:origin},body:JSON.stringify({action:"read",id,email:"forged@example.test"})});
  assert.equal((await handler(request("https://other.test"))).status,403);assert.equal(db.calls.length,0);
  assert.equal((await handler(request("https://hmpeds.com"))).status,200);
  assert.deepEqual(db.calls[0],{name:"hmp_read_completion_notification",args:{p_id:id,p_email:"admin@example.test"}});
});
test("migration is future-only, private, and limits retries within provider idempotency TTL",()=>{
  const sql=readFileSync(new URL("../supabase/migrations/20261021004019_admin_completion_notifications.sql",import.meta.url),"utf8");
  assert.match(sql,/enable row level security/);assert.match(sql,/from public, anon, authenticated/);
  assert.match(sql,/old.status is distinct from new.status/);assert.match(sql,/on conflict\(agreement_id\) do nothing/);
  assert.match(sql,/for update skip locked/);assert.match(sql,/interval '23 hours'/);assert.match(sql,/attempts<5/);
  assert.doesNotMatch(sql,/security definer|update public.hmp_client_agreements/i);
});
test("Mark read updates the current list even after a refresh preserves existing buttons",async()=>{
  class Element {
    children=[]; listeners={}; textContent=""; open=false;
    addEventListener(name,fn){this.listeners[name]=fn;}
    append(...items){this.children.push(...items);}
    replaceChildren(){this.children=[];}
    showModal(){this.open=true;}
    close(){this.open=false;}
  }
  const previous=globalThis.document;
  globalThis.document={createElement:()=>new Element()};
  try {
    const button=new Element(),dialog=new Element(),list=new Element(),status=new Element(),close=new Element(),refresh=new Element();
    dialog.querySelector=selector=>({"[data-notification-list]":list,"[data-notification-status]":status,"[data-notifications-close]":close,"[data-notifications-refresh]":refresh})[selector];
    const notifications=[{id,clientName:"QA",title:"Form",createdAt:new Date().toISOString(),kind:"form_completed",read:false}];
    let openSuccess=false;
    const controller=mountAdminNotifications({button,dialog,openDocument:async()=>openSuccess,fetchFn:async()=>Response.json({notifications})});
    await controller.refresh();
    const originalButton=list.children[0].children[4];
    await controller.refresh();
    assert.equal(list.children[0].children[4],originalButton);
    await originalButton.listeners.click();
    assert.equal(button.textContent,"Notifications");
    const open=list.children[0].children[3];
    await open.listeners.click();
    assert.match(status.textContent,/could not be opened/);
    assert.equal(dialog.open,true);
  } finally {globalThis.document=previous;}
});
