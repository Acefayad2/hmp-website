import test from "node:test";
import assert from "node:assert/strict";
import { manualInquiryRecord } from "../netlify/functions/_manual-inquiry.mts";

const base = { id: "cc704757-571d-43af-a9be-24719e3232e7", name: "Test Client", email: "CLIENT@example.test" };

test("a client can be entered with only name and email", () => {
  const row = manualInquiryRecord(base, "staff@example.test");
  assert.equal(row.email, "client@example.test");
  assert.equal(row.source, "Manual");
  assert.equal(row.submission_id, base.id);
  assert.equal(row.celebration_date, null);
  assert.equal(row.guest_count, null);
});

test("rejects invalid contacts, dates and guest counts", () => {
  for (const values of [{ name: " " }, { email: "bad" }, { eventDate: "2026-02-30" }, { guestCount: "-1" }, { guestCount: "1.5" }, { id: "invalid" }]) {
    assert.throws(() => manualInquiryRecord({ ...base, ...values }, "staff@example.test"));
  }
});

test("keeps entered proposal details and does not accept client-supplied ownership", () => {
  const row = manualInquiryRecord({ ...base, eventDate: "2026-11-25", guestCount: "80", service: "Money Table Services", eventType: "Corporate dinner", location: "Test venue", owner: "someone else", source: "Website" }, "staff@example.test");
  assert.equal(row.celebration_date, "2026-11-25");
  assert.equal(row.guest_count, 80);
  assert.equal(row.owner, "staff@example.test");
  assert.equal(row.source, "Manual");
});
