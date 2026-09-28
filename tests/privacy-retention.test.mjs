import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("privacy retention applies prospectively and explains end-date timing and admin reminder",()=>{
  const html=readFileSync(new URL("../privacy.html",import.meta.url),"utf8");
  assert.match(html,/created under our new retention policy/);
  assert.match(html,/30 days after the event end date/);
  assert.match(html,/existing retention settings/);
  assert.match(html,/reminder on day 29/);
  assert.match(html,/Restoring an event does\s+not restart/);
  assert.match(html,/hourly\s+cleanup/);
});
