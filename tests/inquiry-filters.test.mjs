import test from "node:test";
import assert from "node:assert/strict";
import { inquiryGroups, inquiryFilterTitles, inquiryStatusGroup } from "../src/inquiry-filters.mjs";

const now = new Date(2026, 8, 23, 19);
const entries = [
  { id: "a", status: "New", celebrationDate: "2026-09-23", guestCount: 400 },
  { id: "b", status: "Contacted", celebrationDate: "2026-09-24", guestCount: "400" },
  { id: "c", status: "NEW", celebrationDate: "2026-09-22", guestCount: 100 },
  { id: "d", status: "Booked", celebrationDate: "bad-date", guestCount: "unknown" },
  { id: "e", status: "Closed", celebrationDate: "", guestCount: 0 },
  { id: "f", status: "Archived" },
  { id: "g", status: "Deleted" },
  { id: "h", status: "Quoted" },
];
const ids = (items) => items.map(({ id }) => id);

test("status filters separate active, booked, closed, archived, and deleted inquiries", () => {
  const groups = inquiryGroups(entries, now);
  assert.deepEqual(ids(groups.new), ["a", "b", "c", "h"]);
  assert.deepEqual(ids(groups.booked), ["d"]);
  assert.deepEqual(ids(groups.closed), ["e"]);
  assert.deepEqual(ids(groups.archived), ["f"]);
  assert.deepEqual(ids(groups.deleted), ["g"]);
  assert.equal(Object.values(groups).flat().length, entries.length);
  assert.deepEqual(Object.keys(inquiryFilterTitles), Object.keys(groups));
});

test("legacy and missing statuses remain visible and grouping tolerates casing", () => {
  assert.deepEqual(inquiryGroups([]), { new: [], booked: [], closed: [], archived: [], deleted: [] });
  for (const status of [undefined, null, "", "Contacted", "Quoted", "Unknown"]) assert.equal(inquiryStatusGroup(status), "new");
  assert.equal(inquiryStatusGroup(" BOOKED "), "booked");
});

test("fresh data updates the selected group without mutating the original list", () => {
  const updated = entries.map((item) => item.id === "a" ? { ...item, status: "Booked", guestCount: 500 } : item);
  assert.deepEqual(ids(inquiryGroups(updated, now).new), ["b", "c", "h"]);
  assert.deepEqual(ids(inquiryGroups(updated, now).booked), ["a", "d"]);
  assert.equal(entries[0].status, "New");
});
