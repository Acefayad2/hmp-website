import test from "node:test";
import assert from "node:assert/strict";
import {createDashboardHandler, editableInquiryDetails} from "../netlify/functions/hmp-dashboard.mts";

globalThis.Netlify = {env:{get:key => key === "HMP_ADMIN_EMAILS" ? "admin@example.test" : null}};
const id = "11111111-1111-4111-8111-111111111111";
const version = "2026-11-14T20:00:00.000Z";
const body = {id,action:"edit-details",expectedVersion:version,name:"New Name",email:"NEW@example.test",phone:"301-555-0100",service:"Money Table Services",eventType:"Wedding",eventDate:"2027-01-05",guestCount:"120",location:"Venue",details:"Updated details",secondDate:"2027-01-06",secondStartTime:"10:00",totalServiceHours:"7.5"};
const request = data => new Request("https://hmpeds.com/api/hmp-dashboard",{method:"PATCH",headers:{Origin:"https://hmpeds.com"},body:JSON.stringify(data)});

test("client edits validate contact and event details", () => {
  assert.equal(editableInquiryDetails(body).email,"new@example.test");
  assert.equal(editableInquiryDetails(body).guest_count,120);
  for (const patch of [{name:""},{email:"bad"},{eventDate:"2027-02-30"},{guestCount:"1.5"}])
    assert.throws(() => editableInquiryDetails({...body,...patch}));
});

test("client edits preserve notes, status, records, and reject stale versions", async () => {
  const row = {submission_id:id,updated_at:version,status:"Booked",client_name:"Old Name",email:"old@example.test",internal_notes:"Private note",raw_payload:{original_answer:"keep"}};
  let patch, filters;
  const db = {from(table){assert.equal(table,"hmp_admin_inquiries");filters=[];return {
    update(value){patch=value;return this},
    eq(key,value){filters.push(record=>record[key]===value);return this},
    neq(key,value){filters.push(record=>record[key]!==value);return this},
    is(key,value){filters.push(record=>record[key]===value);return this},
    select(){return this},
    async maybeSingle(){if(!filters.every(match=>match(row)))return {data:null,error:null};Object.assign(row,patch);return {data:{...row},error:null}},
  }} };
  const handler=createDashboardHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db});
  const first=await handler(request(body));
  assert.equal(first.status,200);
  assert.equal((await first.json()).inquiry.name,"New Name");
  assert.equal(row.internal_notes,"Private note");
  assert.equal(row.raw_payload.original_answer,"keep");
  assert.equal(row.raw_payload["second-start-time"],"10:00");
  assert.equal(row.raw_payload["total-service-hours"],"7.5");
  assert.equal(row.status,"Booked");
  assert.equal((await handler(request(body))).status,409);
});
