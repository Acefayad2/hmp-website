import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {webcrypto} from "node:crypto";
import * as drafts from "../agreement-draft.mjs";
import * as progress from "../agreement-progress.mjs";
import {getAgreementTemplate} from "../agreement-schema.mjs";
const source=readFileSync(new URL("../agreement-client.mjs",import.meta.url),"utf8").replace(/^import .*;\n/gm,"").replace(/load\(\);\s*$/, "");
const original={id:"synthetic-form",status:"Sent",clientName:"Test Client",clientEmail:"test@example.test",expiresAt:"2099-01-01T00:00:00Z",snapshot:{...getAgreementTemplate("money-bank-verification"),optionalSecondRepresentative:false,version:"test-1"},adminAnswers:{}};
async function fixture(storage=new Map(),shared){
 const nodes=new Map(), handlers=new Map(),values={clientName:"Test Client",actualBank:"125",reconciledBank:""};let latest=structuredClone(shared||original),failGet=false,failPost=false,padReads=0,posts=0,gets=0,padValid=false;
 const node=key=>{if(!nodes.has(key))nodes.set(key,{textContent:"",children:[],append(...items){this.children.push(...items)},closest(){return this},querySelector:node,classList:{add(){}},scrollIntoView(){},prepend(){},addEventListener(type,fn){handlers.set(key+":"+type,fn)},querySelectorAll(){return []},elements:{namedItem(id){return node(id)}}});return nodes.get(key)};
 const sandbox={...drafts,...progress,crypto:webcrypto,TextEncoder,URLSearchParams,Date,location:{hash:"#token="+"a".repeat(43)},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},window:{addEventListener(){}},document:{querySelector:node,createElement:node},FormData:class{constructor(){return Object.entries(values)}},escape:x=>x,termsHTML:()=>"Original terms",fieldsHTML:(_fields,prefill)=>{Object.assign(values,prefill);return ""},answersHTML:()=>"",completionHTML:()=>"Completed",expiryLabel:x=>x,checkFormInputs:()=>true,validateAnswers:()=>values,showFormIssues(){},confirm:()=>true,mountSignaturePad:()=>({read(){padReads++;if (!padValid) throw Error("Draw unfinished");return null;}}),agreementRequest:async(_url,options)=>{if(options.method==="POST"){posts++;if(failPost||failGet)throw Error("Network offline");const body=JSON.parse(options.body);if(body.action==="save-progress"){if(latest.status!=="Sent")throw Error("Form changed");latest={...latest,updatedAt:"v2",bankProgress:{values:body.answers,updatedAt:"v2"}};return {agreement:latest};}return {agreement:{...latest,status:"Completed",bankProgress:undefined}}}gets++;if(failGet)throw Error("Network offline");return {agreement:latest,signingConsent:"Test consent"}}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);await vm.runInContext("load()",sandbox);
 return {storage,values,node,handlers,get latest(){return latest},get padReads(){return padReads},get posts(){return posts},get gets(){return gets},click:()=>handlers.get("#save-agreement-draft:click")(),submit:()=>handlers.get("#client-agreement-form:submit")({preventDefault(){}}),setLatest:v=>latest=v,setFailGet:v=>failGet=v,setFailPost:v=>failPost=v,setPadValid:()=>padValid=true,sandbox};
}
test("Save ignores incomplete Draw and required fields and restores a shared draft without signing",async()=>{
 const f=await fixture();await f.click();assert.equal(f.padReads,0);assert.equal(f.posts,1);assert.match(f.node("#draft-status").textContent,/Details and initials saved/);
 const next=await fixture(new Map(),f.latest);assert.equal(next.values.actualBank,"125");assert.equal(next.values.reconciledBank,"");assert.match(next.node("#draft-status").textContent,/restored/);
});
test("network and stale form failures keep current entries and prior saved draft",async()=>{
 const f=await fixture();await f.click();const before=JSON.stringify([...f.storage]);f.values.actualBank="999";f.setFailGet(true);await f.click();assert.match(f.node("#draft-status").textContent,/not saved/);assert.equal(f.values.actualBank,"999");assert.equal(JSON.stringify([...f.storage]),before);
 f.setFailGet(false);f.setLatest({...original,status:"Completed"});await f.click();assert.match(f.node("#draft-status").textContent,/not saved/);assert.equal(JSON.stringify([...f.storage]),before);
});
test("repeated clicks are guarded and do not invoke submit",async()=>{
 const f=await fixture();await Promise.all([f.click(),f.click()]);assert.equal(f.gets,1);assert.equal(f.posts,1);assert.equal(f.storage.size,0);
});
test("terms review stays before signing and duplicate expanded template is absent",()=>{
 assert.ok(!source.includes("Money bank verification text"));assert.ok(source.indexOf("Review original form terms before signing")<source.indexOf("Sign & submit form"));assert.ok(source.includes('type="button" id="save-agreement-draft"'));
});

test("failed final submission retains draft; confirmed completion clears only that draft",async()=>{
 const f=await fixture();await f.click();f.setPadValid();f.setFailPost(true);await f.submit();assert.equal(f.latest.bankProgress.values.actualBank,"125");assert.match(f.node("#signature-status").textContent,/Network offline/);
 f.setFailPost(false);await f.submit();assert.equal(f.storage.size,0);assert.match(f.node("#agreement-message").textContent,/signed form has been saved/);
});
