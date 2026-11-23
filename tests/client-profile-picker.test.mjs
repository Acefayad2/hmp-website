import test from "node:test";
import assert from "node:assert/strict";
import { clientProfileValues } from "../src/client-profile-picker.js";

test("client document profiles expose editable contact and event defaults", () => {
  assert.deepEqual(clientProfileValues({
    id: "conversation", inquiryId: "inquiry", clientName: "A Client", clientEmail: "client@example.test",
    clientPhone: "301-555-0100", service: "Guest Seating Experience", celebrationDate: "2027-05-04",
    eventLocation: "The Venue", startTime: "18:00", endTime: "23:00",
  }), {
    inquiryId: "inquiry", conversationId: "conversation", clientName: "A Client", clientEmail: "client@example.test",
    clientPhone: "301-555-0100", eventName: "Guest Seating Experience", eventDate: "2027-05-04",
    eventLocation: "The Venue", eventAddress: "The Venue", services: "Guest Seating Experience",
    scopeOfWork: "Guest Seating Experience", serviceStartTime: "18:00", serviceEndTime: "23:00",
  });
});

test("invoice, agreement and client-form editors mount the optional profile picker", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const path of ["src/admin.js", "src/agreement-admin.js", "src/client-forms.js"]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /mountClientProfilePicker/);
  }
  const admin = await readFile(new URL("../src/admin.js", import.meta.url), "utf8");
  assert.match(admin, /inquiryId: activeInvoiceInquiryId/);
  assert.match(admin, /inquiryId: activeContractInquiryId/);
});
