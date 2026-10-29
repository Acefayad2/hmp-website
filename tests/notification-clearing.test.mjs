import test from "node:test";
import assert from "node:assert/strict";
import {createNotificationsHandler} from "../netlify/functions/hmp-notifications.mts";
import {mountAdminNotifications} from "../src/admin-notifications.js";
const id="11111111-1111-4111-8111-111111111111";
globalThis.Netlify={env:{get:key=>({HMP_ADMIN_EMAILS:"admin@example.test",SUPABASE_URL:"https://example.test",SUPABASE_SERVICE_ROLE_KEY:"synthetic"})[key]}};
test("clear is session-bound, origin protected, bounded and idempotent; filtering precedes limit",async()=>{
  const calls=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});return {error:null};},from(){return {select(){return this;},not(...args){calls.push({filter:args});return this;},order(){return this;},limit(value){calls.push({limit:value});return {data:[],error:null};}};}};
  const handler=createNotificationsHandler({getUserFn:async()=>({email:"ADMIN@example.test"}),databaseFactory:()=>db});
  const post=(body,origin="https://hmpeds.com")=>new Request("https://hmpeds.com/api/hmp-notifications",{method:"POST",headers:{origin},body:JSON.stringify(body)});
  assert.equal((await handler(post({action:"clear",ids:[id]},"https://evil.test"))).status,403);
  for(const ids of [[],["bad"],Array(101).fill(id),null]) assert.equal((await handler(post({action:"clear",ids}))).status,400);
  assert.equal(calls.length,0);
  assert.equal((await handler(post({action:"clear",ids:[id,id],email:"forged@example.test"}))).status,200);
  assert.deepEqual(calls.shift(),{name:"hmp_clear_completion_notifications",args:{p_ids:[id],p_email:"admin@example.test"}});
  await handler(new Request("https://hmpeds.com/api/hmp-notifications"));
  assert.deepEqual(calls,[{filter:["cleared_by","cs",'{"admin@example.test"}']},{limit:100}]);
  db.rpc=async()=>({error:{message:"private database details"}});
  const failed=await handler(post({action:"clear",ids:[id]}));assert.equal(failed.status,502);assert.doesNotMatch(await failed.text(),/private database details/);
  const denied=createNotificationsHandler({getUserFn:async()=>null,databaseFactory:()=>{throw Error("Must not query");}});
  assert.equal((await denied(post({action:"clear",ids:[id]}))).status,401);
});

test("clear UI preserves rows on failure, confirms bulk selection, prevents races and keeps new arrivals",async()=>{
  class Element {
    children=[];listeners={};textContent="";attrs={};
    addEventListener(name,fn){this.listeners[name]=fn;}
    append(...items){this.children.push(...items);}
    replaceChildren(){this.children=[];}
    setAttribute(name,value){this.attrs[name]=value;}
    close(){} showModal(){}
  }
  const previous=globalThis.document;globalThis.document={createElement:()=>new Element()};
  try {
    const button=new Element(),dialog=new Element(),list=new Element(),status=new Element(),clear=new Element();
    const selectors={"[data-notification-list]":list,"[data-notification-status]":status,"[data-notifications-close]":new Element(),"[data-notifications-refresh]":new Element(),"[data-notifications-clear]":clear};
    dialog.querySelector=s=>selectors[s];dialog.querySelectorAll=()=>list.children.flatMap(item=>item.children.filter(c=>"data-notification-clear" in c.attrs));
    const row={id,clientName:"Client",title:"Form",createdAt:"2026-10-29",read:false};
    let serverRows=[row],fail=true,confirm=false,resolvePost;
    const posts=[];
    const api=mountAdminNotifications({button,dialog,openDocument:async()=>true,confirmFn:()=>confirm,fetchFn:async(url,options={})=>{
      if(options.method!=="POST")return Response.json({notifications:serverRows});
      const body=JSON.parse(options.body);posts.push(body);
      if(fail)return new Response("",{status:502});
      await new Promise(resolve=>{resolvePost=resolve;});
      serverRows=serverRows.filter(row=>!body.ids.includes(row.id));return Response.json({ok:true});
    }});
    await api.refresh();await list.children[0].children.at(-1).listeners.click();
    assert.equal(list.children.length,1);assert.match(status.textContent,/could not be cleared/);assert.equal(clear.disabled,false);
    await clear.listeners.click();assert.equal(posts.length,1,"cancel makes no request");
    fail=false;confirm=true;
    const pending=clear.listeners.click();assert.equal(clear.disabled,true);
    await clear.listeners.click();await api.refresh();assert.equal(posts.length,2);
    serverRows.push({...row,id:"22222222-2222-4222-8222-222222222222"});
    resolvePost();await pending;
    assert.equal(list.children.length,0);assert.equal(button.textContent,"Notifications");
    assert.deepEqual(posts[1],{action:"clear",ids:[id]});
    await api.refresh();assert.equal(list.children.length,1,"new notification survives clear all shown");
    assert.equal(button.textContent,"Notifications (1)");
  }finally{globalThis.document=previous;}
});
