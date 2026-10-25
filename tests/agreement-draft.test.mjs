import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {getAgreementTemplate} from "../agreement-schema.mjs";
import {draftContext, draftFields, saveDraft, readDraft, clearDraft} from "../agreement-draft.mjs";
const now = Date.parse("2026-10-25T20:00:00Z");
const agreement = {id:"synthetic-one", status:"Sent", snapshot:{...getAgreementTemplate("money-bank-verification"),version:"test-1"},adminAnswers:{},expiresAt:"2026-10-27T00:00:00Z"};
const token = "a".repeat(43);
const context = () => draftContext(agreement, token, webcrypto.subtle);
function memory(){const map=new Map();return {map,getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test("incomplete draft resumes names and amounts without signing evidence or access tokens", async()=>{
 const c=await context(),s=memory();saveDraft(s,c,{clientName:"Synthetic <test>",actualBank:"120",reconciledBank:"",representativeOneSignature:"Never save",representativeOneName:"Test Person",receivedInitials:"TP",representativeOneDate:"2026-10-25",consent:"on",signatureName:"Never save",token},now);
 assert.deepEqual(readDraft(s,c,now+1).values,{clientName:"Synthetic <test>",actualBank:"120",reconciledBank:"",representativeOneName:"Test Person"});
 assert.ok(!JSON.stringify([...s.map]).includes(token));assert.ok(!JSON.stringify([...s.map]).includes("Never save"));
});
test("draft keys isolate private links and agreement revisions", async()=>{
 const a=await context();for(const other of [{...agreement,id:"two"},{...agreement,snapshot:{...agreement.snapshot,version:"test-2"}}]){
 const b=await draftContext(other,token,webcrypto.subtle);assert.ok(a.key!==b.key || a.fingerprint!==b.fingerprint);
 }assert.notEqual(a.key,(await draftContext(agreement,"b".repeat(43),webcrypto.subtle)).key);
});
test("stale, expired and future-clock drafts never restore",async()=>{
 const c=await context(),s=memory();saveDraft(s,c,{actualBank:"12"},now);assert.equal(readDraft(s,{...c,fingerprint:"new"},now+1),null);
 saveDraft(s,c,{},now);assert.equal(readDraft(s,c,now+86400001),null);
 saveDraft(s,c,{},now);assert.equal(readDraft(s,c,now-1),null);
 assert.throws(()=>saveDraft(s,c,{},Date.parse(agreement.expiresAt)),/no longer available/);
});
test("completed/other forms cannot save and success clearing is scoped",async()=>{
 assert.equal(await draftContext({...agreement,status:"Completed"},token,webcrypto.subtle),null);
 assert.equal(await draftContext({...agreement,snapshot:{...agreement.snapshot,id:"other"}},token,webcrypto.subtle),null);
 const c=await context(),s=memory();s.setItem("unrelated","safe");saveDraft(s,c,{},now);clearDraft(s,c);assert.equal(s.getItem(c.key),null);assert.equal(s.getItem("unrelated"),"safe");
});
test("storage and corrupt payload failures cannot report a saved or restored draft",async()=>{
 const c=await context();assert.throws(()=>saveDraft({setItem(){throw Error("Quota");}},c,{},now),/Quota/);
 assert.throws(()=>saveDraft({setItem(){},getItem(){return null;}},c,{},now),/confirm/);
 const s=memory();s.setItem(c.key,"broken");assert.throws(()=>readDraft(s,c,now),/cannot be read/);
 assert.throws(()=>saveDraft(s,c,{clientName:"x".repeat(5001)},now),/too long/);
});
test("repeated saving replaces only the local draft and caps lifetime at link expiry",async()=>{
 const c=await context(),s=memory();saveDraft(s,c,{actualBank:"1"},now);saveDraft(s,c,{actualBank:"2"},now+1);assert.equal(s.map.size,1);assert.equal(readDraft(s,c,now+2).values.actualBank,"2");
 const near={...c,agreement:{...agreement,expiresAt:new Date(now+1000).toISOString()}};assert.equal(saveDraft(s,near,{},now).expiresAt,now+1000);
 assert.ok(draftFields(agreement.snapshot).every(f=>!f.id.includes("Signature")));
});
