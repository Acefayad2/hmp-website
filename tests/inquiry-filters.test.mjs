import test from "node:test";
import assert from "node:assert/strict";
import { inquiryGroups, inquiryFilterTitles } from "../src/inquiry-filters.mjs";

const now = new Date(2026, 8, 23, 19);
const entries = [
  { id: "a", status: "New", celebrationDate: "2026-09-23", guestCount: 400 },
  { id: "b", status: "Contacted", celebrationDate: "2026-09-24", guestCount: "400" },
  { id: "c", status: "NEW", celebrationDate: "2026-09-22", guestCount: 100 },
  { id: "d", status: "Booked", celebrationDate: "bad-date", guestCount: "unknown" },
  { id: "e", status: "Closed", celebrationDate: "", guestCount: 0 },
];
const ids = (items) => items.map(({ id }) => id);

test("summary filters include new, today's and future events, and all largest ties", () => {
  const groups = inquiryGroups(entries, now);
  assert.equal(groups.all, entries);
  assert.deepEqual(ids(groups.new), ["a", "c"]);
  assert.deepEqual(ids(groups.upcoming), ["a", "b"]);
  assert.deepEqual(ids(groups.largest), ["a", "b"]);
  assert.deepEqual(Object.keys(inquiryFilterTitles), Object.keys(groups));
});

test("empty or unknown guest counts do not produce a largest event", () => {
  assert.deepEqual(inquiryGroups([], now), { all: [], new: [], upcoming: [], largest: [] });
  assert.deepEqual(inquiryGroups([{ guestCount: null }, { guestCount: "" }, { guestCount: Infinity }], now).largest, []);
});

test("fresh data updates the selected group without mutating the original list", () => {
  const updated = entries.map((item) => item.id === "a" ? { ...item, status: "Booked", guestCount: 500 } : item);
  assert.deepEqual(ids(inquiryGroups(updated, now).new), ["c"]);
  assert.deepEqual(ids(inquiryGroups(updated, now).largest), ["a"]);
  assert.equal(entries[0].status, "New");
});
