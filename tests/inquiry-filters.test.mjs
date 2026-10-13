import test from "node:test";
import assert from "node:assert/strict";
import { inquiryGroups, inquiryFilterTitles } from "../src/inquiry-filters.mjs";

const entries = [
  { id: "a", status: "New" },
  { id: "b", status: "Contacted" },
  { id: "c", status: "Quoted" },
  { id: "d", status: "Booked" },
  { id: "e", status: "Closed" },
  { id: "f", status: "Archived" },
  { id: "g", status: "Deleted" },
  { id: "h", status: "BOOKED" },
];
const ids = (items) => items.map(({ id }) => id);

test("each inquiry appears in exactly one visible or recoverable group", () => {
  const groups = inquiryGroups(entries);
  assert.deepEqual(ids(groups.inquiries), ["a", "b", "c"]);
  assert.deepEqual(ids(groups.booked), ["d", "h"]);
  assert.deepEqual(ids(groups.closed), ["e"]);
  assert.deepEqual(ids(groups.archived), ["f"]);
  assert.deepEqual(ids(groups.deleted), ["g"]);
  assert.deepEqual(Object.keys(groups), Object.keys(inquiryFilterTitles));
  assert.deepEqual(Object.values(groups).flat().map(({ id }) => id).sort(), ids(entries).sort());
});

test("empty and old statuses stay in Inquiries without changing saved data", () => {
  const old = [{ id: "x" }, { id: "y", status: "Pending" }];
  assert.deepEqual(ids(inquiryGroups(old).inquiries), ["x", "y"]);
  assert.deepEqual(inquiryGroups([]), { inquiries: [], booked: [], closed: [], archived: [], deleted: [] });
  assert.equal(old[1].status, "Pending");
});

test("status changes move a record between groups without mutating the original list", () => {
  const updated = entries.map((item) => item.id === "a" ? { ...item, status: "Closed" } : item);
  assert.deepEqual(ids(inquiryGroups(updated).inquiries), ["b", "c"]);
  assert.deepEqual(ids(inquiryGroups(updated).closed), ["a", "e"]);
  assert.equal(entries[0].status, "New");
});
