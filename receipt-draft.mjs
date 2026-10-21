import { paymentMethods, standaloneReceiptDetails } from "./receipt-template.mjs";

// Drafts may be incomplete; confirmation is deliberately never persisted.
export function receiptDraftPayload(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid receipt draft.");
  if (input.receiptMode && !["invoice", "standalone"].includes(input.receiptMode)) throw new Error("Choose an invoice-linked or standalone receipt.");
  const payload = {};
  for (const [key, limit] of Object.entries({ amountPaid: 20, paymentDate: 10, paymentMethod: 40, reference: 120, note: 1000 })) {
    const value = input[key] ?? "";
    if (typeof value !== "string" || value.length > limit) throw new Error(`Check ${key}: the draft value is invalid or too long.`);
    payload[key] = value.trim();
  }
  if (payload.amountPaid && (!/^\d+(?:\.\d{1,2})?$/.test(payload.amountPaid) || !Number.isSafeInteger(Math.round(Number(payload.amountPaid) * 100)))) throw new Error("Amount paid to date must use no more than two decimal places, or be left blank in a draft.");
  if (payload.paymentMethod && !paymentMethods.includes(payload.paymentMethod)) throw new Error("Choose a payment method or leave it blank in the draft.");
  if (payload.paymentDate) {
    const date = new Date(`${payload.paymentDate}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.paymentDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== payload.paymentDate) throw new Error("Enter a valid payment date or leave it blank in the draft.");
  }
  return input.receiptMode === "standalone" ? { ...payload, receiptMode: "standalone", ...standaloneReceiptDetails(input) } : payload;
}
