import test from "node:test";
import assert from "node:assert/strict";
import { agreementTemplates, validateAnswers } from "../agreement-schema.mjs";
import { snapshotFor, completionPayload, publicAgreement, agreementToken, hash } from "../netlify/functions/_agreement-forms.mts";
import { createAgreementHandler } from "../netlify/functions/hmp-agreement-forms.mts";
import { fieldsHTML, answersHTML } from "../agreement-ui.mjs";

globalThis.Netlify = {env:{get:name => ({SUPABASE_URL:"https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY:"test-only-secret", HMP_ADMIN_EMAILS:"admin@example.test", RESEND_API_KEY:"test-only-resend", HMP_CONTRACT_FROM_EMAIL:"forms@example.test"})[name]}};
const id = "11111111-1111-4111-8111-111111111111";
const inputFor = fields => Object.fromEntries(fields.map(f => [f.id, f.options?.[0] || ({date:"2026-12-01", time:"17:00", "datetime-local":"2026-12-01T17:00", money:"100", number:"2", email:"client@example.test"}[f.type] || "Example value")]));
const rowFor = (templateId = "guest-seating") => {
  const snapshot = snapshotFor(templateId);
  return {id, template_id:templateId, snapshot, client_name:"Test Client", client_email:"client@example.test", status:"Sent", expires_at:"2099-01-01T00:00:00Z", admin_answers:inputFor(snapshot.adminFields), token_nonce:"seed", token_hash:hash(agreementToken(id,"seed")), updated_at:"2026-09-23T00:00:00Z"};
};
function fakeDatabase(rows) {
  return {from() {
    let filters = [], operation = "read", payload;
    const query = {
      select(){return this;}, order(){return this;}, limit(){return this;},
      eq(key,value){filters.push(r => r[key] === value); return this;},
      in(key,values){filters.push(r => values.includes(r[key])); return this;},
      gt(key,value){filters.push(r => r[key] > value); return this;},
      insert(value){operation="insert";payload=value;return this;}, update(value){operation="update";payload=value;return this;},
      execute(single=false) {
        let found = rows.filter(row => filters.every(f => f(row)));
        if (operation === "insert") {const row={status:"Draft",client_answers:{},updated_at:new Date().toISOString(), ...payload}; rows.push(row); found=[row];}
        if (operation === "update") found.forEach(row => Object.assign(row,payload));
        return {data:single ? found[0] || null : found, error:null};
      },
      single(){return Promise.resolve(this.execute(true));}, maybeSingle(){return Promise.resolve(this.execute(true));},
      then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject);},
    }; return query;
  }};
}
const request = (route, method="GET", body, token) => new Request(`https://hmpeds.com/api/${route}`, {method, headers:{Origin:"https://hmpeds.com", "Content-Type":"application/json", ...(token ? {Authorization:`Bearer ${token}`} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
function handlerFor(rows, admin=true, send=async()=>new Response("{}",{status:200})) {
  return createAgreementHandler({getUserFn:async()=>admin ? {email:"admin@example.test"} : null, databaseFactory:()=>fakeDatabase(rows), fetchFn:send});
}

test("four templates retain complete terms and approved four-revision limit", () => {
  assert.equal(agreementTemplates.length,4);
  for(const t of agreementTemplates) {
    const s=snapshotFor(t.id);
    assert.ok(s.pages.length >= 8);
    assert.match(s.pages.join("\n"), /CLIENT ACKNOWLEDGMENT|AGREEMENT ACKNOWLEDGMENT/);
    assert.equal(new Set([...s.adminFields,...s.clientFields].map(f=>f.id)).size, s.adminFields.length+s.clientFields.length);
    assert.match(s.sourceSha256,/^[a-f0-9]{64}$/);
  }
  const led=snapshotFor("led-customization").pages.join("\n");
  assert.match(led,/Included Revisions: 4 Revisions/);
  assert.doesNotMatch(led,/six\s*\(6\)/);
});
test("validation covers required data, explicit choices, dates, limits and injection escaping", () => {
  const fields=snapshotFor("guest-seating").clientFields;
  assert.throws(()=>validateAnswers(fields,{}),/required/);
  assert.throws(()=>validateAnswers(fields,{...inputFor(fields),marketingConsent:"maybe"}),/invalid/);
  assert.throws(()=>validateAnswers(fields,{...inputFor(fields),eventDate:"2026-02-30"}),/invalid/);
  assert.throws(()=>validateAnswers(fields,{...inputFor(fields),guestCount:"-1"}),/invalid/);
  assert.throws(()=>validateAnswers(fields,{...inputFor(fields),clientName:"x".repeat(501)}),/too long/);
  assert.doesNotMatch(fieldsHTML(fields,{clientName:'"><script>alert(1)</script>'}), /<script>/);
  assert.doesNotMatch(answersHTML(fields,{clientName:"<img src=x>"}), /<img/);
});
test("completion requires consent, validates all answers, stamps signature and hides access secrets", () => {
  const row=rowFor();
  const body={answers:inputFor(row.snapshot.clientFields),signatureName:"Test Client",consent:true};
  assert.throws(()=>completionPayload(row,{...body,consent:false}),/consent/);
  const completed=completionPayload(row,body,"Test browser");
  assert.equal(completed.status,"Completed");
  assert.match(completed.record_hash,/^[a-f0-9]{64}$/);
  assert.equal(completed.signature.consent,row.snapshot.signingConsent);
  assert.throws(()=>completionPayload({...row,status:"Completed"},body),/not open/);
  assert.throws(()=>completionPayload({...row,expires_at:"2000-01-01"},body),/not open/);
  assert.ok(!("token_nonce" in publicAgreement(row)));
  assert.ok(!("token_hash" in publicAgreement(row)));
});
test("unauthorized admins, cross-origin writes and missing or unrelated client tokens are denied", async () => {
  const row=rowFor(), handler=handlerFor([row],false);
  assert.equal((await handler(request("hmp-agreement-forms"))).status,401);
  assert.equal((await handler(request("hmp-agreement"))).status,401);
  assert.equal((await handler(request("hmp-agreement","GET",null,"x".repeat(43)))).status,410);
  assert.equal((await handler(new Request("https://hmpeds.com/api/hmp-agreement",{method:"POST",headers:{Origin:"https://evil.test"}}))).status,403);
});
test("client submission saves once, retries return the same record, admin cannot modify completed form", async () => {
  const row=rowFor(), rows=[row], handler=handlerFor(rows);
  const token=agreementToken(id,"seed");
  const body={answers:inputFor(row.snapshot.clientFields),signatureName:"Test Client",consent:true};
  const res=await handler(request("hmp-agreement","POST",body,token));
  assert.equal(res.status,200); assert.equal(row.status,"Completed");
  const fingerprint=row.record_hash;
  const retry=await handler(request("hmp-agreement","POST",{...body,signatureName:"Different"},token));
  assert.equal(retry.status,200); assert.equal(row.record_hash,fingerprint); assert.equal(row.signature.name,"Test Client");
  assert.equal((await handler(request("hmp-agreement-forms","PATCH",{id,action:"save"}))).status,409);
  assert.equal((await handler(request("hmp-agreement-forms","PATCH",{id,action:"void"}))).status,409);
});
test("all four client forms can be completed with their full field sets", async () => {
  for(const t of agreementTemplates) {
    const row=rowFor(t.id), handler=handlerFor([row]);
    const result=await handler(request("hmp-agreement","POST",{answers:inputFor(row.snapshot.clientFields),signatureName:"Test Client",consent:true},agreementToken(id,"seed")));
    assert.equal(result.status,200,t.id); assert.equal(Object.keys(row.client_answers).length,row.snapshot.clientFields.length);
  }
});
test("draft creation cannot spoof status, owner, terms or signature; send locks snapshot and reuses email key", async () => {
  const rows=[], mail=[];
  const handler=handlerFor(rows,true,async(url,options)=>{mail.push(options);return new Response("{}",{status:200});});
  const snapshot=snapshotFor("guest-seating");
  let res=await handler(request("hmp-agreement-forms","POST",{templateId:"guest-seating",clientName:"Test",clientEmail:"client@example.test",answers:inputFor(snapshot.adminFields),status:"Completed",created_by:"spoof",snapshot:{pages:["fake"]}}));
  assert.equal(res.status,201); const row=rows[0];
  assert.equal(row.status,"Draft"); assert.equal(row.created_by,"admin@example.test"); assert.deepEqual(row.snapshot.pages,snapshot.pages);
  assert.equal((await handler(request("hmp-agreement-forms","PATCH",{id:row.id,action:"send",updatedAt:row.updated_at}))).status,400);
  res=await handler(request("hmp-agreement-forms","PATCH",{id:row.id,action:"send",updatedAt:row.updated_at,hmpConsent:true}));
  assert.equal(res.status,200); assert.equal(row.status,"Sent"); assert.ok(row.admin_answers.hmpSignedAt);
  assert.equal((await handler(request("hmp-agreement-forms","PATCH",{id:row.id,action:"save"}))).status,409);
  await handler(request("hmp-agreement-forms","PATCH",{id:row.id,action:"send"}));
  assert.equal(mail.length,1,"successful delivery retries must not send duplicate emails");
  assert.equal(mail[0].headers["Idempotency-Key"],`hmp-agreement/${row.id}`);
  assert.deepEqual(JSON.parse(mail[0].body).to,["client@example.test"]);
});

test("failed email keeps a recoverable sent record and retries use the same idempotency key", async()=>{
  const row={...rowFor(),status:"Draft"}, mail=[];
  const handler=handlerFor([row],true,async(url,options)=>{mail.push(options);return new Response("{}",{status:mail.length===1?502:200});});
  const first=await handler(request("hmp-agreement-forms","PATCH",{id,action:"send",updatedAt:row.updated_at,hmpConsent:true}));
  assert.equal(first.status,502);assert.equal(row.status,"Sent");
  const failed=await first.json();assert.match(failed.link,/agreement#token=/);
  const retry=await handler(request("hmp-agreement-forms","PATCH",{id,action:"send"}));
  assert.equal(retry.status,200);assert.equal(mail[0].headers["Idempotency-Key"],mail[1].headers["Idempotency-Key"]);
});
test("voided or expired links cannot read or sign and stale drafts cannot overwrite newer edits", async()=>{
  const row=rowFor(), handler=handlerFor([row]);
  await handler(request("hmp-agreement-forms","PATCH",{id,action:"void"}));
  assert.equal((await handler(request("hmp-agreement","GET",null,agreementToken(id,"seed")))).status,410);
  row.status="Sent";row.expires_at="2000-01-01";
  assert.equal((await handler(request("hmp-agreement","GET",null,agreementToken(id,"seed")))).status,410);
  row.status="Draft";
  assert.equal((await handler(request("hmp-agreement-forms","PATCH",{id,action:"save",clientName:"Changed",clientEmail:"client@example.test",answers:{},updatedAt:"old"}))).status,409);
  assert.equal(row.client_name,"Test Client");
});
