import test from "node:test";
import assert from "node:assert/strict";
import { createReceipt, receiptHTML } from "../receipt-template.mjs";
import { receiptDraftPayload } from "../receipt-draft.mjs";

const invoice = { id: "test-invoice", invoiceNumber: "HMP-1001", status: "Paid", currency: "USD", clientName: "Test Client", clientEmail: "test@example.test", eventName: "Test event", eventDate: "2026-09-24", eventAddress: "Venue\nLaurel, MD", items: [{ description: "Guest seating\nArrival and directory", amount: 1000 }], subtotal: 1000, discountAmount: 100, taxAmount: 54, total: 954, notes: "Do not copy invoice notes", paymentTerms: "Do not request payment again" };
const details = { amountPaid: "954.00", paymentDate: "2026-09-24", paymentMethod: "Bank transfer", reference: "REF-123", confirmed: true };
const make = (record = invoice, fields = details) => createReceipt(record, fields, "2026-09-25");

test("receipt uses saved invoice amounts and client/event details without mutating the invoice", () => {
  const receipt = make();
  assert.equal(receipt.receiptNumber, "R-HMP-1001");
  assert.equal(receipt.amountPaid, 954);
  assert.equal(receipt.balance, 0);
  assert.equal(receipt.eventAddress, invoice.eventAddress);
  assert.equal(receipt.issuedDate, "2026-09-25");
  assert.equal(receipt.paymentDate, "2026-09-24");
  assert.equal(receipt.notes, undefined);
  assert.equal(receipt.paymentTerms, undefined);
  assert.equal(invoice.status, "Paid");
});

test("draft, void, deleted and invalid invoices cannot produce a receipt", () => {
  for (const status of ["Draft", "Void", ""]) assert.throws(() => make({ ...invoice, status }), /Sent, Partially paid/);
  assert.throws(() => make({ ...invoice, deletedAt: "2026-09-25" }), /Sent, Partially paid/);
  for (const total of [NaN, Infinity, -1, 0, "954"]) assert.throws(() => make({ ...invoice, total }), /valid receipt details/);
  assert.throws(() => make({ ...invoice, currency: "EUR" }), /valid receipt details/);
});

test("partial payments use the entered cumulative amount, even if the invoice was marked Paid", () => {
  for (const status of ["Sent", "Partially paid", "Paid"]) {
    const record = { ...invoice, status };
    const receipt = make(record, { ...details, amountPaid: "400.50" });
    assert.equal(receipt.amountPaid, 400.5);
    assert.equal(receipt.balance, 553.5);
    assert.equal(receipt.total, 954);
    assert.equal(record.status, status);
    const html = receiptHTML(receipt);
    assert.match(html, /Partial payment received/);
    assert.match(html, /Amount paid to date/);
    assert.match(html, /\$400\.50/);
    assert.match(html, /\$553\.50/);
    assert.doesNotMatch(html, /Paid in full|acknowledges full payment|No payment is due/);
  }
});

test("only a zero calculated balance shows Paid in full, regardless of saved status", () => {
  const receipt = make({ ...invoice, status: "Sent" });
  assert.equal(receipt.balance, 0);
  assert.match(receiptHTML(receipt), /Paid in full/);
  assert.doesNotMatch(receiptHTML(receipt), /Partial payment received/);
});

test("IMG_1916: reopen a retainer draft and issue a full-payment copy without rewriting the earlier receipt", () => {
  const record = { ...invoice, status: "Sent" };
  const saved = receiptDraftPayload({ ...details, amountPaid: "354.00", note: "Retainer received" });
  const retainer = make(record, { ...saved, confirmed: true });
  const issuedRetainerHTML = receiptHTML(retainer);
  assert.equal(retainer.balance, 600);
  assert.match(issuedRetainerHTML, /Partial payment received/);

  // A reopened draft has no saved payment confirmation, even after the first PDF.
  const reopened = receiptDraftPayload(JSON.parse(JSON.stringify(saved)));
  assert.throws(() => make(record, reopened), /Confirm/);
  reopened.amountPaid = "954.00";
  reopened.note = "Full balance paid";
  const finalReceipt = make(record, { ...reopened, confirmed: true });
  assert.equal(finalReceipt.balance, 0);
  assert.match(receiptHTML(finalReceipt), /Paid in full/);
  assert.match(receiptHTML(finalReceipt), /Full balance paid/);
  assert.equal(retainer.balance, 600);
  assert.equal(receiptHTML(retainer), issuedRetainerHTML);
  assert.equal(record.status, "Sent", "editing a receipt must not update the invoice automatically");
});

test("an actual positive amount no greater than the invoice total is required", () => {
  for (const amountPaid of [undefined, null, "", " ", "0", "0.001", "-1", "954.01", "400.555", "1e2", "0x10", "1,000", "bad", NaN, Infinity, true, [], {}]) {
    assert.throws(() => make(invoice, { ...details, amountPaid }), /Amount paid to date/);
  }
  assert.equal(make(invoice, { ...details, amountPaid: 400.5 }).balance, 553.5);
});

test("balance calculations use cents so tiny floating point remainders do not mislabel receipts", () => {
  assert.equal(make({ ...invoice, total: 0.3 }, { ...details, amountPaid: "0.10" }).balance, 0.2);
  assert.equal(make(invoice, { ...details, amountPaid: "953.99" }).balance, 0.01);
});

test("actual payment details and explicit confirmation are required", () => {
  for (const paymentDate of ["", "2026-02-30", "2026-13-01", "2026-09-26", "not-a-date"]) assert.throws(() => make(invoice, { ...details, paymentDate }), /payment date/);
  assert.throws(() => make(invoice, { ...details, paymentMethod: "" }), /payment method/);
  assert.throws(() => make(invoice, { ...details, confirmed: false }), /Confirm/);
  assert.throws(() => make(invoice, { ...details, reference: "x".repeat(121) }), /120/);
  assert.throws(() => make(invoice, { ...details, note: "x".repeat(1001) }), /1,000/);
});

test("client receipt escapes content, retains line breaks and has no invoice payment request", () => {
  const html = receiptHTML(make({ ...invoice, clientName: "<script>alert(1)</script>", items: [{ description: "Guest seating\n<img onerror=alert(1)>", amount: 1000 }] }, { ...details, note: "Thanks <b>client</b>" }));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Guest seating\n&lt;img"));
  assert.ok(html.includes("Paid in full"));
  assert.ok(html.includes("$954.00"));
  assert.ok(html.includes("$0.00"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes(invoice.paymentTerms));
});
