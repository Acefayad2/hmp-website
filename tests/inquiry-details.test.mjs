import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeInquiry, createDashboardHandler} from "../netlify/functions/hmp-dashboard.mts";
import {inquiryDetailFields, inquiryDetailsHTML} from "../src/inquiry-details.js";
import {escape} from "../agreement-ui.mjs";

const answers = {
  name:"Example Client", email:"qa@example.test", phone:"555-0100", "contact-method":"Text",
  service:"Multiple services", "service-option":"Arrival + Directory", "multiple-services-detail":"Seating\nMoney table", "other-service-detail":"Custom service",
  "guest-count":"270", "parking-fee":"No", "celebration-type":"Wedding", "celebration-date":"2026-11-07",
  location:"First Hall\n10 Example Lane", "start-time":"17:00", "end-time":"22:00", "vendor-exit-time":"00:30",
  "service-start-time":"16:30", "service-end-time":"22:30", "total-service-hours":"6",
  "second-date":"2026-11-08", "second-location":"Second Hall\n20 Example Lane", "second-guest-count":"150",
  "second-start-time":"10:00", "second-end-time":"15:00", "second-vendor-exit-time":"16:00",
  "second-service-start-time":"09:30", "second-service-end-time":"15:30",
  "referral-source":"Referral", "source-detail":"Friend", "additional-information":"Additional notes\nSecond line",
};
const mapping = {
  name:["name","client_name"],email:["email","email"],phone:["phone","phone"],"contact-method":["contactMethod","preferred_contact"],
  service:["service","service"],"service-option":["serviceOption"],"multiple-services-detail":["multipleServicesDetail"],"other-service-detail":["otherServiceDetail"],
  "guest-count":["guestCount","guest_count"],"parking-fee":["parkingFee","parking_fee"],"celebration-type":["celebrationType","celebration_type"],
  "celebration-date":["celebrationDate","celebration_date"],location:["location","location"],"start-time":["startTime","start_time"],"end-time":["endTime","end_time"],
  "vendor-exit-time":["vendorExitTime"],"second-date":["secondDate","second_date"],"second-location":["secondLocation"],"second-guest-count":["secondGuestCount"],
  "service-start-time":["serviceStartTime"],"service-end-time":["serviceEndTime"],"total-service-hours":["totalServiceHours"],
  "second-start-time":["secondStartTime"],"second-end-time":["secondEndTime"],"second-vendor-exit-time":["secondVendorExitTime"],
  "second-service-start-time":["secondServiceStartTime"],"second-service-end-time":["secondServiceEndTime"],
  "referral-source":["referralSource","referral_source"],"source-detail":["sourceDetail","referral_detail"],"additional-information":["additionalInformation","additional_information"],
};
const record = () => ({submission_id:"11111111-1111-4111-8111-111111111111",raw_payload:{...answers,subject:"Hidden transport metadata",unrecognized:"Do not expose"},
  ...Object.fromEntries(Object.entries(mapping).filter(([,keys])=>keys[1]).map(([key,keys])=>[keys[1],answers[key]]))});
const render = item => inquiryDetailsHTML(item, {escapeHTML:escape,formatDate:value=>`date:${value}`});

test("every public inquiry question is mapped and displayed in Admin, not transport metadata", () => {
  const html = readFileSync(new URL("../inquiry.html",import.meta.url),"utf8");
  const form = html.slice(html.indexOf('id="inquiry-form"'),html.indexOf('</form>',html.indexOf('id="inquiry-form"')));
  const fields = [...form.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)].map(match=>match[1]).filter(name=>!["form-name","subject","submission-id","bot-field"].includes(name));
  assert.deepEqual(fields.sort(),Object.keys(mapping).sort());
  const input = record(), before = structuredClone(input), normalized = normalizeInquiry(input), rendered = render(normalized);
  for(const [key,[property]] of Object.entries(mapping)) {
    assert.equal(normalized[property],answers[key],key);
    if(!["name","additionalInformation"].includes(property)) {
      assert.ok(inquiryDetailFields.some(([,field])=>field===property),property);
      assert.ok(rendered.includes(escape(answers[key])),key);
    }
  }
  const admin = readFileSync(new URL("../src/admin.js",import.meta.url),"utf8");
  assert.match(admin,/inquiryDetailsHTML\(item, \{formatDate, escapeHTML\}\)/);
  assert.match(admin,/\$\("#detail-name"\).textContent = item.name/);
  assert.match(admin,/note.querySelector\("p"\).textContent = item.additionalInformation/);
  assert.equal(normalized.raw_payload,undefined);
  assert.equal(normalized.unrecognized,undefined);
  assert.doesNotMatch(rendered,/Hidden transport metadata|Do not expose/);
  assert.deepEqual(input,before);
});

test("saved schedules fall back to raw answers; canonical values win without inventing missing answers", () => {
  const normalized = normalizeInquiry({start_time:"18:00",end_time:null,second_date:null,raw_payload:answers});
  assert.equal(normalized.startTime,"18:00");
  assert.equal(normalized.endTime,"22:00");
  assert.equal(normalized.secondDate,"2026-11-08");
  for(const raw_payload of [undefined,null,[],"invalid",42]) {
    const old = normalizeInquiry({client_name:"Older inquiry",raw_payload});
    assert.equal(old.vendorExitTime,"");
    assert.doesNotMatch(render(old),/vendor exit|Second event|Services requested/);
  }
  const bad = normalizeInquiry({raw_payload:{"vendor-exit-time":{},"second-start-time":[],"second-guest-count":0}});
  assert.equal(bad.vendorExitTime,"");
  assert.equal(bad.secondStartTime,"");
  assert.match(render(bad),/Second event guest count<\/dt><dd>0/);
});

test("detail renderer escapes submitted markup, keeps multiline answers and labels schedule values separately", () => {
  const input = record();input.raw_payload["multiple-services-detail"] = '<img src=x onerror="bad()">\nSecond line';
  const html = render(normalizeInquiry(input));
  assert.doesNotMatch(html,/<img/);
  assert.match(html,/&lt;img/);
  assert.match(html,/\nSecond line/);
  for(const [label,time] of [["First event start time","17:00"],["First event end time","22:00"],["First event vendor exit time","00:30"],["First event service start time","16:30"],["First event service end time","22:30"],["Second event start time","10:00"],["Second event end time","15:00"],["Second event vendor exit time","16:00"],["Second event service start time","09:30"],["Second event service end time","15:30"],["Total hours of service","6"]]) {
    assert.ok(html.includes(`<dt>${label}</dt><dd>${time}</dd>`));
  }
});

test("authenticated dashboard GET returns complete existing answers while non-admin requests stay blocked", async () => {
  globalThis.Netlify = {env:{get:key=>key==="HMP_ADMIN_EMAILS"?"admin@example.test":undefined}};
  const db = {from(table){assert.equal(table,"hmp_admin_inquiries");return {select(value){assert.equal(value,"*");return this;},order(){return this;},async limit(){return {data:[record()],error:null};}};}};
  const request = new Request("https://hmpeds.com/api/hmp-dashboard");
  const handler = createDashboardHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db});
  const response = await handler(request);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  const data = await response.json();
  assert.equal(data.inquiries[0].vendorExitTime,"00:30");
  assert.equal(data.inquiries[0].secondLocation,answers["second-location"]);
  assert.equal(data.inquiries[0].otherServiceDetail,"Custom service");
  for(const user of [null,{email:"client@example.test"}]) {
    const blocked = createDashboardHandler({getUserFn:async()=>user,databaseFactory:()=>{throw new Error("Must not query");}});
    assert.equal((await blocked(request)).status,401);
  }
});
