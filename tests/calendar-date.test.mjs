import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const renderInZone = (timeZone, value) => execFileSync(process.execPath, [
  "--input-type=module", "-e",
  `import { parseCalendarDate } from "./calendar-date.mjs";
   const date = parseCalendarDate(${JSON.stringify(value)});
   console.log(new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: ${JSON.stringify(timeZone)} }).format(date));`,
], { cwd: new URL("..", import.meta.url), env: { ...process.env, TZ: timeZone }, encoding: "utf8" }).trim();

test("event calendar dates show the selected day in eastern and western time zones", () => {
  for (const zone of ["America/New_York", "America/Los_Angeles"]) {
    assert.equal(renderInZone(zone, "2026-10-20"), "Oct 20, 2026");
  }
});

test("timestamps keep their existing instant-based formatting", () => {
  assert.equal(renderInZone("America/New_York", "2026-10-20T00:30:00Z"), "Oct 19, 2026");
});
