import test from "node:test";
import assert from "node:assert/strict";
import { agreementTemplates, validateAnswers } from "../agreement-schema.mjs";
import { snapshotFor, completionPayload, publicAgreement, agreementToken, hash, issuedSnapshot, editableSnapshot } from "../netlify/functions/_agreement-forms.mts";
import { createAgreementHandler } from "../netlify/functions/hmp-agreement-forms.mts";
import { fieldsHTML, answersHTML } from "../agreement-ui.mjs";
import { informationTemplates } from "../information-form-schema.mjs";

globalThis.Netlify = {env:{get:name => ({SUPABASE_URL:"https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY:"test-only-secret", HMP_ADMIN_EMAILS:"admin@example.test", RESEND_API_KEY:"test-only-resend", HMP_CONTRACT_FROM_EMAIL:"forms@example.test"})[name]}};
const id = "11111111-1111-4111-8111-111111111111";
const inputFor = fields => Object.fromEntries(fields.map(f => [f.id, f.options?.[0] || ({date:"2026-12-01", time:"17:00", "datetime-local":"2026-12-01T17:00", money:"100", number:"2", decimal:"4.5", email:"client@example.test"}[f.type] || "Example value") ]));
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

test("eight templates retain sourced terms and approved four-revision limit", () => {
  assert.equal(agreementTemplates.length,8);
  for(const t of agreementTemplates) {
    const s=snapshotFor(t.id);
    assert.ok(s.pages.length >= 1);
    assert.ok(s.pages.join("\n").length > 100);
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
test("new document titles and wording stay in their draft, while money amounts and dated clauses are materialized on issue", () => {
  const template = snapshotFor("money-collecting-changing");
  const edited = editableSnapshot(template, {title:"Client-specific money table agreement", pages:["Custom opening page", ...template.pages.slice(1)]});
  assert.equal(edited.title,"Client-specific money table agreement");
  assert.equal(edited.pages[0],"Custom opening page");
  assert.notEqual(template.pages[0],"Custom opening page");
  const answers = {...inputFor(template.adminFields), agreementDate:"2026-12-01", serviceFee:"1500", serviceHours:"6.5", cancellationDeadline:"2026-11-01", cancellationRefundAmount:"1050", includeCommission:"No", includeTravelFee:"No", includeGrandTotal:"No"};
  assert.equal(validateAnswers(template.adminFields, answers).serviceHours,"6.5");
  assert.throws(()=>validateAnswers(template.adminFields,{...answers,serviceHours:"3.5"}),/at least four hours/);
  const issued = issuedSnapshot(template, answers);
  const text = issued.pages.join("\n");
  assert.match(text,/\$1500\.00/);
  assert.match(text,/6\.5 Service Hours/);
  assert.match(text,/2026-11-01/);
  assert.doesNotMatch(text,/\{\{|2025|IF NOT NEEDED|ONLY KEEP THIS PART|\$585|\$835/);
  assert.equal(issued.optionalClauses,undefined);
  assert.throws(()=>editableSnapshot(template,{pages:["missing"]}),/page/);
});
test("on-site bank verification requires all three matching signatures and never emails the form", async () => {
  const row={...rowFor("money-bank-verification"),status:"Draft"};
  const handler=handlerFor([row]);
  assert.equal((await handler(request("hmp-agreement-forms","PATCH",{id,action:"send",updatedAt:row.updated_at}))).status,400);
  assert.equal((await handler(request("hmp-agreement-forms","PATCH",{id,action:"share",updatedAt:row.updated_at}))).status,200);
  const answers=inputFor(row.snapshot.clientFields);
  answers.representativeOneName="First Signer";answers.representativeOneSignature="First Signer";
  answers.representativeTwoName="Second Signer";answers.representativeTwoSignature="Second Signer";
  answers.attendantName="HMP Attendant";
  const token=agreementToken(id,"seed");
  const submit=body=>handler(request("hmp-agreement","POST",body,token));
  assert.equal((await submit({answers,signatureName:"HMP Attendant",consent:true,representativeOneConsent:true})).status,400);
  assert.equal((await submit({answers:{...answers,representativeTwoSignature:"Someone Else"},signatureName:"HMP Attendant",consent:true,representativeOneConsent:true,representativeTwoConsent:true})).status,400);
  assert.equal((await submit({answers,signatureName:"HMP Attendant",consent:true,representativeOneConsent:true,representativeTwoConsent:true})).status,200);
  assert.equal(row.status,"Completed");
  assert.equal(row.signature.representativeOneConsent,true);
  assert.equal(row.signature.representativeTwoConsent,true);
});
for (const templateId of ["money-collecting", "money-collecting-changing"]) {
  test(`${templateId}: service times survive old draft save, reopen, issue and client completion`, async () => {
    const row = {...rowFor(templateId), status:"Draft"};
    row.snapshot = {...row.snapshot, title:"Custom draft title", adminFields:row.snapshot.adminFields.filter(field => field.id !== "serviceStartTime")};
    row.snapshot.pages = [...row.snapshot.pages];
    row.snapshot.pages[0] += "\nClient-specific wording stays unchanged.";
    delete row.admin_answers.serviceStartTime;
    const original = structuredClone(row.snapshot);
    const handler = handlerFor([row]);
    const reopened = await (await handler(request(`hmp-agreement-forms?id=${id}`))).json();
    const fields = reopened.agreement.snapshot.adminFields;
    const startIndex = fields.findIndex(field => field.id === "serviceStartTime");
    assert.equal(fields[startIndex + 1].id, "serviceEndTime");
    assert.equal(fields[startIndex].type, "time");
    assert.equal(fields[startIndex].required, true);
    assert.deepEqual(row.snapshot, original, "Reading a draft must not write to storage");
    const missing = await handler(request("hmp-agreement-forms", "PATCH", {id, action:"share", updatedAt:row.updated_at, hmpConsent:true}));
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, "Scheduled service start time is required.");
    assert.equal(row.status, "Draft");
    assert.throws(() => validateAnswers(fields, {...row.admin_answers, serviceStartTime:"25:00"}), /Scheduled service start time/);
    // A service may cross midnight; do not assume an end time must be later on the same day.
    const answers = {...row.admin_answers, serviceStartTime:"20:30", serviceEndTime:"00:30"};
    const saved = await handler(request("hmp-agreement-forms", "PATCH", {id, action:"save", updatedAt:row.updated_at, clientName:row.client_name, clientEmail:row.client_email, answers}));
    assert.equal(saved.status, 200);
    assert.equal(row.admin_answers.serviceStartTime, "20:30");
    assert.equal(row.snapshot.adminFields.filter(field => field.id === "serviceStartTime").length, 1);
    assert.equal(row.snapshot.title, original.title);
    assert.deepEqual(row.snapshot.pages, original.pages);
    const loaded = await (await handler(request(`hmp-agreement-forms?id=${id}`))).json();
    assert.equal(loaded.agreement.adminAnswers.serviceStartTime, "20:30");
    assert.match(fieldsHTML(fields, loaded.agreement.adminAnswers), /name="serviceStartTime"[^>]*value="20:30"/);
    const shared = await handler(request("hmp-agreement-forms", "PATCH", {id, action:"share", updatedAt:row.updated_at, hmpConsent:true}));
    assert.equal(shared.status, 200);
    const token = agreementToken(id, "seed");
    const client = await (await handler(request("hmp-agreement", "GET", null, token))).json();
    const details = answersHTML(client.agreement.snapshot.adminFields, client.agreement.adminAnswers);
    assert.match(details, /Scheduled service start time<\/dt><dd>20:30/);
    assert.match(details, /Scheduled service end time<\/dt><dd>00:30/);
    const completed = await handler(request("hmp-agreement", "POST", {answers:inputFor(row.snapshot.clientFields), signatureName:"Test Client", consent:true}, token));
    assert.equal(completed.status, 200);
    assert.equal(row.admin_answers.serviceStartTime, "20:30");
    assert.equal(row.status, "Completed");
    assert.equal((await handler(request("hmp-agreement-forms", "PATCH", {id, action:"save", answers:{serviceStartTime:"10:00"}}))).status, 409);
  });
}
test("older sent and completed money agreements retain their exact snapshots", async () => {
  for (const status of ["Sent", "Completed"]) {
    const row = {...rowFor("money-collecting-changing"), status};
    row.snapshot = {...row.snapshot, adminFields:row.snapshot.adminFields.filter(field => field.id !== "serviceStartTime")};
    delete row.admin_answers.serviceStartTime;
    const original = structuredClone(row);
    const handler = handlerFor([row]);
    for (const response of [await handler(request(`hmp-agreement-forms?id=${id}`)), await handler(request("hmp-agreement", "GET", null, agreementToken(id,"seed")))]) {
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).agreement.snapshot, original.snapshot);
    }
    assert.deepEqual(row, original);
  }
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
test("all agreement and verification forms can be completed with their full field sets", async () => {
  for(const t of agreementTemplates) {
    const row=rowFor(t.id), handler=handlerFor([row]);
    const answers=inputFor(row.snapshot.clientFields);
    const onSite=t.signatureMode === "on-site-three-signatures";
    if (onSite) {answers.representativeOneName="First Signer";answers.representativeOneSignature="First Signer";answers.representativeTwoName="Second Signer";answers.representativeTwoSignature="Second Signer";answers.attendantName="HMP Attendant";}
    const result=await handler(request("hmp-agreement","POST",{answers,signatureName:onSite ? "HMP Attendant" : "Test Client",consent:true,representativeOneConsent:onSite,representativeTwoConsent:onSite},agreementToken(id,"seed")));
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
  assert.equal(mail[0].headers["Idempotency-Key"],`hmp-agreement/${row.id}/${hash(row.token_nonce)}`);
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

for (const template of informationTemplates) {
  test(`${template.id}: create, share, validate, submit, reopen and view saved answers in Admin`, async () => {
    const rows = [], mail = [];
    const admin = handlerFor(rows, true, async (...args) => {mail.push(args); return new Response("{}");});
    const client = handlerFor(rows, false);
    const create = await admin(request("hmp-agreement-forms", "POST", {templateId:template.id, clientName:"Test Client", clientEmail:"client@example.test", answers:{eventName:"Test event"}, snapshot:{kind:"contract"}, status:"Completed"}));
    assert.equal(create.status, 201);
    const row = rows[0];
    assert.equal(row.status, "Draft"); assert.equal(row.snapshot.kind, "information");
    const token = agreementToken(row.id, row.token_nonce);
    assert.equal((await client(request("hmp-agreement", "GET", null, token))).status, 410);
    const share = await admin(request("hmp-agreement-forms", "PATCH", {id:row.id, action:"share", updatedAt:row.updated_at}));
    assert.equal(share.status, 200);
    assert.match((await share.json()).link, /https:\/\/hmpeds.com\/agreement#token=/);
    assert.equal(mail.length, 0, "Creating a private link must not email a client");
    assert.equal(row.admin_answers.hmpSignedAt, undefined);
    assert.equal((await client(request("hmp-agreement", "GET", null, token))).status, 200);
    assert.equal((await client(request("hmp-agreement", "POST", {answers:{}}, token))).status, 400);
    assert.equal(row.status, "Sent", "Validation failure must leave form open");
    const detailId = row.snapshot.clientFields.some(field => field.id === "responsibleContact") ? "responsibleContact" : "additionalInformation";
    const answers = {...inputFor(row.snapshot.clientFields), [detailId]:"First line\nSecond line", injectedField:"ignore me"};
    const submit = await client(request("hmp-agreement", "POST", {answers}, token));
    assert.equal(submit.status, 200); assert.equal(row.status, "Completed");
    assert.equal(row.signature, null); assert.equal(row.client_answers.injectedField, undefined);
    assert.equal(row.client_answers[detailId], answers[detailId]);
    const fingerprint = row.record_hash;
    const retry = await client(request("hmp-agreement", "POST", {answers:{[detailId]:"overwritten"}}, token));
    assert.equal(retry.status, 200); assert.equal(row.record_hash, fingerprint);
    for (const response of [await client(request("hmp-agreement", "GET", null, token)), await admin(request(`hmp-agreement-forms?id=${row.id}`))]) {
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.agreement.clientAnswers[detailId], answers[detailId]);
      assert.equal(data.agreement.token_nonce, undefined); assert.equal(data.agreement.token_hash, undefined);
    }
    assert.equal((await admin(request("hmp-agreement-forms", "PATCH", {id:row.id, action:"save"}))).status, 409);
  });
}

test("information email uses native form wording without signing and only sends once", async () => {
  const row = {...rowFor(informationTemplates[0].id), status:"Draft"}, mail = [];
  const handler = handlerFor([row], true, async (_,options) => {mail.push(JSON.parse(options.body)); return new Response("{}");});
  const sent = await handler(request("hmp-agreement-forms", "PATCH", {id,action:"send",updatedAt:row.updated_at}));
  assert.equal(sent.status, 200);
  assert.match(mail[0].html, /Complete your form/);
  assert.doesNotMatch(mail[0].html, /complete, and sign|Complete and sign/);
  await handler(request("hmp-agreement-forms", "PATCH", {id,action:"send"}));
  assert.equal(mail.length, 1);
});

test("agreement link-only activation requires HMP consent and sends no email", async () => {
  const row = {...rowFor(), status:"Draft"};
  assert.equal((await handlerFor([row])(request("hmp-agreement-forms", "PATCH", {id,action:"share",updatedAt:row.updated_at}))).status, 400);
  assert.equal(row.status, "Draft");
  let emails=0;
  const handler=handlerFor([row],true,async()=>{emails++;return new Response("{}",{status:200});});
  const result=await handler(request("hmp-agreement-forms","PATCH",{id,action:"share",updatedAt:row.updated_at,hmpConsent:true}));
  assert.equal(result.status,200);
  assert.match((await result.json()).link,/agreement#token=/);
  assert.equal(row.status,"Sent");
  assert.equal(emails,0);
});

test("information storage failure does not claim completion", async () => {
  const row = rowFor(informationTemplates[0].id);
  const db = fakeDatabase([row]);
  const original = db.from;
  db.from = () => {
    const query = original();
    query.update = () => ({eq(){return this;}, gt(){return this;}, select(){return this;}, maybeSingle:async()=>({error:{message:"unavailable"},data:null})});
    return query;
  };
  const handler = createAgreementHandler({getUserFn:async()=>null,databaseFactory:()=>db});
  const result = await handler(request("hmp-agreement", "POST", {answers:inputFor(row.snapshot.clientFields)}, agreementToken(id,"seed")));
  assert.equal(result.status, 502); assert.equal(row.status, "Sent");
  assert.match((await result.json()).error, /could not be saved/);
});

test("new agreements and information forms expire exactly seven days after activation", async (t) => {
  const now = Date.parse("2026-10-16T18:00:00Z");
  t.mock.timers.enable({apis:["Date"], now});
  for (const template of ["guest-seating", informationTemplates[0].id]) {
    const row = {...rowFor(template), status:"Draft"}, mail = [];
    const handler = handlerFor([row], true, async (_, options) => {mail.push(JSON.parse(options.body)); return new Response("{}");});
    const sent = await handler(request("hmp-agreement-forms", "PATCH", {id, action:"send", updatedAt:row.updated_at, hmpConsent:true}));
    assert.equal(sent.status, 200);
    assert.equal(Date.parse(row.expires_at), now + 7 * 86400000);
    assert.match(mail[0].html, /valid for 7 days/);
    assert.doesNotMatch(mail[0].html, /90 days/);
    const token = agreementToken(id, row.token_nonce);
    t.mock.timers.setTime(now + 7 * 86400000 - 1);
    assert.equal((await handler(request("hmp-agreement", "GET", null, token))).status, 200);
    t.mock.timers.setTime(now + 7 * 86400000);
    assert.equal((await handler(request("hmp-agreement", "GET", null, token))).status, 410);
    assert.equal((await handler(request("hmp-agreement", "POST", {answers:{}}, token))).status, 410);
    t.mock.timers.setTime(now);
  }
});

test("expired forms renew and resend without changing document details; old tokens stay invalid", async () => {
  for (const template of ["guest-seating", informationTemplates[0].id]) {
    const row = {...rowFor(template), expires_at:"2000-01-01T00:00:00Z", email_delivered_at:"1999-12-25T00:00:00Z"};
    const original = structuredClone(row), mail = [];
    const handler = handlerFor([row], true, async (_, options) => {mail.push(options); return new Response("{}");});
    const before = Date.now();
    const result = await handler(request("hmp-agreement-forms", "PATCH", {id, action:"resend", updatedAt:row.updated_at}));
    assert.equal(result.status, 200);
    assert.equal(mail.length, 1);
    assert.ok(Date.parse(row.expires_at) >= before + 7 * 86400000);
    assert.ok(Date.parse(row.expires_at) <= Date.now() + 7 * 86400000);
    assert.deepEqual(row.snapshot, original.snapshot);
    assert.deepEqual(row.admin_answers, original.admin_answers);
    assert.equal(row.sent_at, original.sent_at);
    assert.notEqual(row.token_nonce, original.token_nonce);
    assert.equal((await handler(request("hmp-agreement", "GET", null, agreementToken(id, original.token_nonce)))).status, 410);
    assert.equal((await handler(request("hmp-agreement", "POST", {answers:{}}, agreementToken(id, original.token_nonce)))).status, 410);
    assert.equal((await handler(request("hmp-agreement", "GET", null, agreementToken(id, row.token_nonce)))).status, 200);
    assert.equal((await handler(request("hmp-agreement-forms", "PATCH", {id, action:"resend", updatedAt:original.updated_at}))).status, 409);
    assert.equal(mail.length, 1);
  }
});

test("renewal rejects unauthorized, stale, void, completed and unexpired requests", async () => {
  for (const status of ["Draft", "Void", "Completed", "Sent"]) {
    const row = {...rowFor(), status}, original = structuredClone(row);
    const handler = handlerFor([row]);
    assert.equal((await handler(request("hmp-agreement-forms", "PATCH", {id, action:"resend", updatedAt:row.updated_at}))).status, 409);
    assert.deepEqual(row, original);
  }
  const row = {...rowFor(), expires_at:"2000-01-01T00:00:00Z"}, original = structuredClone(row);
  assert.equal((await handlerFor([row], false)(request("hmp-agreement-forms", "PATCH", {id, action:"renew", updatedAt:row.updated_at}))).status, 401);
  assert.equal((await handlerFor([row])(request("hmp-agreement-forms", "PATCH", {id, action:"renew", updatedAt:"stale"}))).status, 409);
  assert.deepEqual(row, original);
});

test("on-site renewal stays link-only and failed renewed emails can retry without renewing again", async () => {
  const row = {...rowFor("money-bank-verification"), expires_at:"2000-01-01T00:00:00Z"};
  let emails = 0;
  const handler = handlerFor([row], true, async () => {emails++; return new Response("{}");});
  assert.equal((await handler(request("hmp-agreement-forms", "PATCH", {id, action:"resend", updatedAt:row.updated_at}))).status, 400);
  assert.equal((await handler(request("hmp-agreement-forms", "PATCH", {id, action:"renew", updatedAt:row.updated_at}))).status, 200);
  assert.equal(emails, 0);
  const retryRow = {...rowFor(), expires_at:"2000-01-01T00:00:00Z", email_delivered_at:"1999-12-25"}, mail=[];
  const retryHandler = handlerFor([retryRow], true, async (_, options) => {mail.push(options); return new Response("{}", {status:mail.length === 1 ? 502 : 200});});
  const first = await retryHandler(request("hmp-agreement-forms", "PATCH", {id, action:"resend", updatedAt:retryRow.updated_at}));
  assert.equal(first.status, 502);
  assert.ok((await first.json()).link);
  const token = retryRow.token_nonce, expiry = retryRow.expires_at;
  assert.equal((await retryHandler(request("hmp-agreement-forms", "PATCH", {id, action:"send"}))).status, 200);
  assert.equal(retryRow.token_nonce, token); assert.equal(retryRow.expires_at, expiry);
  assert.equal(mail[0].headers["Idempotency-Key"], mail[1].headers["Idempotency-Key"]);
});

test("retrying an existing active link preserves its promised deadline", async () => {
  const row = rowFor(), expiry = row.expires_at, seed = row.token_nonce, mail=[];
  const handler = handlerFor([row], true, async (_, options) => {mail.push(JSON.parse(options.body)); return new Response("{}");});
  assert.equal((await handler(request("hmp-agreement-forms", "PATCH", {id, action:"send"}))).status, 200);
  assert.equal(row.expires_at, expiry); assert.equal(row.token_nonce, seed);
  assert.ok(mail[0].html.includes(new Date(expiry).toLocaleString("en-US", {timeZone:"America/New_York", timeZoneName:"short"})));
});

test("a token rotated between client read and completion cannot submit", async () => {
  const row = rowFor(), db = fakeDatabase([row]), originalFrom = db.from;
  db.from = () => {
    const query = originalFrom(), update = query.update;
    query.update = function (payload) {
      row.token_hash = hash("a-different-token");
      return update.call(this, payload);
    };
    return query;
  };
  const handler = createAgreementHandler({getUserFn:async()=>null, databaseFactory:()=>db});
  const response = await handler(request("hmp-agreement", "POST", {answers:inputFor(row.snapshot.clientFields), signatureName:"Test Client", consent:true}, agreementToken(id,"seed")));
  assert.equal(response.status, 409);
  assert.equal(row.status, "Sent"); assert.equal(row.signature, undefined);
});
