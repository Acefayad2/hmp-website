import test from "node:test";
import assert from "node:assert/strict";
import { createReceipt, receiptHTML } from "../receipt-template.mjs";

const invoice = { id: "test-invoice", invoiceNumber: "HMP-1001", status: "Paid", currency: "USD", clientName: "Test Client", clientEmail: "test@example.test", eventName: "Test event", eventDate: "2026-09-24", eventAddress: "Venue\nLaurel, MD", items: [{ description: "Guest seating\nArrival and directory", amount: 1000 }], subtotal: 1000, discountAmount: 100, taxAmount: 54, total: 954, notes: "Do not copy invoice notes", paymentTerms: "Do not request payment again" };
const details = { paymentDate: "2026-09-24", paymentMethod: "Bank transfer", reference: "REF-123", confirmed: true };
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

test("draft, sent, void and invalid invoices cannot produce a paid receipt", () => {
  for (const status of ["Draft", "Sent", "Void", ""]) assert.throws(() => make({ ...invoice, status }), /Paid/);
  for (const total of [NaN, Infinity, -1, 0, "954"]) assert.throws(() => make({ ...invoice, total }), /valid receipt details/);
  assert.throws(() => make({ ...invoice, currency: "EUR" }), /valid receipt details/);
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
