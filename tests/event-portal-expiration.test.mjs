import test from "node:test";
import assert from "node:assert/strict";
import {eventPortalDeadline, eventPortalExpired, cappedPortalExpiration} from "../event-portal-expiration.mjs";

test("15-day limit is measured from the end, not deletion, creation or sharing",()=>{
  const event={date:"2026-10-01T12:00:00Z",endDate:"2026-10-03T04:00:00Z",deletedAt:"2099-01-01",createdAt:"2000-01-01"};
  const cutoff=Date.parse("2026-10-18T04:00:00Z");
  assert.equal(eventPortalDeadline(event),cutoff);
  assert.equal(eventPortalExpired(event,cutoff-1),false);
  assert.equal(eventPortalExpired(event,cutoff),true);
  assert.equal(cappedPortalExpiration(event,"2099-01-01"),new Date(cutoff).toISOString());
  assert.equal(cappedPortalExpiration(event,"2026-10-04"),"2026-10-04T00:00:00.000Z");
});
test("date-only events close at end of day 15 in the business zone, including DST and year rollover",()=>{
  for(const [date,expected] of [["2026-10-01","2026-10-17T03:59:59.999Z"],["2026-10-23","2026-11-08T04:59:59.999Z"],["2026-02-28","2026-03-16T03:59:59.999Z"],["2026-12-25","2027-01-10T04:59:59.999Z"]])
    assert.equal(new Date(eventPortalDeadline({date})).toISOString(),expected);
});
test("unscheduled inquiries keep their deadline; malformed dates fail closed",()=>{
  assert.equal(eventPortalDeadline({}),null);
  assert.equal(eventPortalExpired({}),false);
  assert.equal(cappedPortalExpiration({},"2099-01-01"),"2099-01-01");
  for(const date of ["bad","2026-02-30","2026-10-01T12:00:00"])
    assert.equal(eventPortalExpired({date}),true);
});

