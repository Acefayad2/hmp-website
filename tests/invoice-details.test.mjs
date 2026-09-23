import test from "node:test";
import assert from "node:assert/strict";
import { cleanPayload, normalizeInvoice } from "../netlify/functions/hmp-invoices.mts";
import { renderEmail } from "../netlify/functions/hmp-send-invoice.mts";

const draft = {
  clientName: "Test Client", clientEmail: "client@example.test", issueDate: "2026-09-23",
  eventAddress: "Test Venue\n123 Example Street\nLaurel, MD 20707",
  items: [{ description: "Money Table Services\nChanging + Collecting\nThree attendants", quantity: 2, rate: 450 }],
};

test("invoice details retain line breaks through save and reopen", () => {
  const row = cleanPayload(draft);
  const invoice = normalizeInvoice(row);
  assert.equal(row.event_address, draft.eventAddress);
  assert.equal(invoice.eventAddress, draft.eventAddress);
  assert.equal(invoice.items[0].description, draft.items[0].description);
  assert.equal(invoice.total, 900);
  assert.ok(!Object.hasOwn(row, "billing_address"));
});

test("event addresses never inherit or overwrite historical billing addresses", () => {
  assert.equal(normalizeInvoice({ billing_address: "Private billing location" }).eventAddress, "");
  const { eventAddress, ...olderClient } = draft;
  assert.ok(!Object.hasOwn(cleanPayload(olderClient), "event_address"));
  assert.equal(cleanPayload({ ...draft, eventAddress: "" }).event_address, null);
  assert.equal(cleanPayload({ ...draft, eventAddress: "x".repeat(1001) }).event_address.length, 1000);
});

test("email preserves newlines and safely escapes descriptions and event addresses", () => {
  const row = cleanPayload({ ...draft, eventAddress: "Venue <script>\nSecond line", items: [{ description: "Service <img>\nMore & details", quantity: 1, rate: 900 }] });
  const html = renderEmail(row);
  assert.ok(html.includes("Event address:</strong><br>Venue &lt;script&gt;<br>Second line"));
  assert.ok(html.includes("Service &lt;img&gt;<br>More &amp; details"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!renderEmail({ ...row, event_address: null }).includes("Event address:"));
});
