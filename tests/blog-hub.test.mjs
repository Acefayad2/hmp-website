import test from "node:test";
import assert from "node:assert/strict";
import {createBlogHandler} from "../netlify/functions/hmp-blog.mts";

globalThis.Netlify={env:{get:key=>({HMP_ADMIN_EMAILS:"admin@example.com"})[key]}};
function fixture(user={email:"admin@example.com"}){
  const rows=new Map(),files=new Set();
  const db={from(table){
    assert.equal(table,"hmp_seating_records");let predicate=()=>true;
    const chain={select(){return chain;},eq(_column,value){predicate=row=>row.key===value;return chain;},like(_column,pattern){predicate=row=>row.key.startsWith(pattern.slice(0,-1));return chain;},async maybeSingle(){return {data:[...rows.values()].find(predicate)||null,error:null};},async limit(){return {data:[...rows.values()].filter(predicate),error:null};},async upsert(row){rows.set(row.key,row);return {error:null};},delete(){return {eq:async(_column,value)=>{rows.delete(value);return {error:null};}}}};
    return chain;
  },storage:{from(bucket){assert.equal(bucket,"hmp-conversation-attachments");return {async createSignedUploadUrl(path){return {data:{signedUrl:`https://storage.example/upload/${path}`},error:null};},async createSignedUrl(path){return {data:{signedUrl:`https://storage.example/read/${path}`},error:null};},async list(folder){return {data:[...files].filter(x=>x.startsWith(`${folder}/`)).map(x=>({name:x.slice(folder.length+1)})),error:null};},async remove(paths){paths.forEach(path=>files.delete(path));return {error:null};}};}}};
  const handler=createBlogHandler({getUserFn:async()=>user,databaseFactory:()=>db});
  const request=(method="GET",body=null,query="",origin="https://hmpeds.com")=>new Request(`https://hmpeds.com/api/hmp-blog${query}`,{method,headers:{origin,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  return {rows,files,handler,request};
}

test("draft stories and private settings require Admin verification",async()=>{
  const {handler,request}=fixture();
  assert.equal((await fixture(null).handler(request("GET",null,"?admin=1"))).status,401);
  assert.equal((await handler(request("POST",{action:"settings",title:"X",categories:["A","B","C","D"]},"","https://other.example"))).status,403);
  const saved=await handler(request("POST",{action:"save-story",title:"A celebration",category:"celebrations",summary:"A lovely event",content:"",status:"draft"}));
  assert.equal(saved.status,200);
  assert.equal((await (await handler(request())).json()).stories.length,0);
  assert.equal((await (await handler(request("GET",null,"?admin=1"))).json()).stories.length,1);
  const story=(await saved.json()).story;
  assert.equal((await handler(request("POST",{action:"save-story",...story,status:"published"}))).status,200);
  assert.equal((await (await handler(request())).json()).stories.length,1);
});

test("public media is issued only for published stories and completed uploads",async()=>{
  const {handler,request,files}=fixture();
  const prepared=await (await handler(request("POST",{action:"prepare-media",type:"image/jpeg",size:1000}))).json();
  const data={action:"save-story",title:"Event day",summary:"A look inside",category:"behind-scenes",mediaPaths:[prepared.path],status:"published"};
  assert.equal((await handler(request("POST",data))).status,400);
  files.add(prepared.path);
  assert.equal((await handler(request("POST",data))).status,200);
  const stories=(await (await handler(request())).json()).stories;
  assert.match(stories[0].media[0].url,/storage\.example\/read/);
  assert.equal((await handler(request("POST",{...data,mediaPaths:["inventory/private.jpg"]}))).status,400);
  assert.equal((await handler(request("POST",{...data,mediaPaths:Array(11).fill(prepared.path)}))).status,400);
});

test("published stories can be edited in place and unpublished without deleting the draft",async()=>{
  const {handler,request}=fixture();
  const first=(await (await handler(request("POST",{action:"save-story",title:"First title",summary:"Opening",category:"celebrations",status:"published"}))).json()).story;
  const edited=(await (await handler(request("POST",{action:"save-story",id:first.id,title:"Updated title",summary:"Revised",category:"celebrations",status:"published"}))).json()).story;
  assert.equal(edited.id,first.id);
  assert.equal(edited.publishedAt,first.publishedAt);
  assert.equal((await (await handler(request())).json()).stories[0].title,"Updated title");
  assert.equal((await handler(request("POST",{action:"unpublish-story",id:first.id}))).status,200);
  assert.equal((await (await handler(request())).json()).stories.length,0);
  const adminStories=(await (await handler(request("GET",null,"?admin=1"))).json()).stories;
  assert.equal(adminStories[0].title,"Updated title");
  assert.equal(adminStories[0].status,"draft");
});
