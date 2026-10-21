import { escape } from "./agreement-ui.mjs";
import { receiptableStatuses } from "./invoice-status.mjs";

export const paymentMethods = ["Bank transfer", "Credit / debit card", "Cash", "Check", "Zelle", "Other"];
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const dateLabel = value => value ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "Not specified";
export const standaloneReceiptFields = { receiptNumber: 60, clientName: 160, clientEmail: 254, eventName: 200, eventDate: 10, serviceDescription: 1000, serviceTotal: 20 };

export function standaloneReceiptDetails(input) {
  const result = {};
  for (const [key, limit] of Object.entries(standaloneReceiptFields)) {
    const value = input[key] ?? "";
    if (typeof value !== "string" || value.length > limit) throw new Error(`Check ${key}: the value is invalid or too long.`);
    result[key] = value.trim();
  }
  if (result.eventDate && !validDate(result.eventDate)) throw new Error("Enter a valid event date or leave it blank.");
  if (result.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.clientEmail)) throw new Error("Enter a valid client email or leave it blank.");
  if (result.serviceTotal && (!/^\d+(?:\.\d{1,2})?$/.test(result.serviceTotal) || !Number.isSafeInteger(Math.round(Number(result.serviceTotal) * 100)) || Number(result.serviceTotal) <= 0)) throw new Error("Service total must be greater than zero with no more than two decimal places, or left blank.");
  return result;
}

function paymentDetails(details, today, totalCents, totalLabel = "invoice total") {
  const amountText = typeof details.amountPaid === "string" || typeof details.amountPaid === "number" ? String(details.amountPaid).trim() : "";
  const paidCents = /^\d+(?:\.\d{1,2})?$/.test(amountText) ? Math.round(Number(amountText) * 100) : NaN;
  if (!Number.isSafeInteger(paidCents) || paidCents <= 0 || (totalCents !== null && paidCents > totalCents)) throw new Error(`Amount paid to date must be greater than $0.00, ${totalCents === null ? "" : `no more than the ${totalLabel} of ${money(totalCents / 100)}, `}and use no more than two decimal places.`);
  if (!validDate(details.paymentDate || "") || details.paymentDate > today) throw new Error("Enter the actual payment date, no later than today.");
  if (!paymentMethods.includes(details.paymentMethod)) throw new Error("Choose the payment method used by the client.");
  const reference = String(details.reference || "").trim(), note = String(details.note || "").trim();
  if (reference.length > 120 || note.length > 1000) throw new Error("Keep the payment reference under 120 characters and the receipt note under 1,000 characters.");
  if (details.confirmed !== true) throw new Error("Confirm that the amount paid to date entered above has actually been received before preparing a receipt.");
  return { amountPaid: paidCents / 100, balance: totalCents === null ? null : (totalCents - paidCents) / 100,
    issuedDate: today, paymentDate: details.paymentDate, paymentMethod: details.paymentMethod, reference, note };
}

export function createStandaloneReceipt(details, today = localDate()) {
  const fields = standaloneReceiptDetails(details);
  if (!fields.receiptNumber) throw new Error("Enter a receipt number.");
  if (!fields.clientName) throw new Error("Enter the client's name.");
  if (!fields.serviceDescription) throw new Error("Enter the service or payment description.");
  const totalCents = fields.serviceTotal ? Math.round(Number(fields.serviceTotal) * 100) : null;
  return { ...fields, standalone: true, total: totalCents === null ? null : totalCents / 100,
    ...paymentDetails(details, today, totalCents, "service total") };
}

export function createReceipt(invoice, details, today = localDate()) {
  if (!invoice?.id || invoice.deletedAt || !receiptableStatuses.includes(invoice.status)) throw new Error("Choose an invoice saved with Sent, Partially paid, or Paid in full status before creating a receipt.");
  if (!invoice.invoiceNumber || !invoice.clientName || invoice.currency !== "USD" || typeof invoice.total !== "number" || !Number.isFinite(invoice.total) || invoice.total <= 0) throw new Error("This invoice does not have valid receipt details. Review it in Invoices first.");
  const totalCents = Math.round(invoice.total * 100);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error("This invoice does not have valid receipt details. Review it in Invoices first.");
  return {
    receiptNumber: `R-${invoice.invoiceNumber}`, invoiceNumber: invoice.invoiceNumber,
    clientName: invoice.clientName, clientEmail: invoice.clientEmail,
    eventName: invoice.eventName, eventDate: invoice.eventDate, eventAddress: invoice.eventAddress,
    items: (invoice.items || []).map(item => ({ description: item.description, amount: item.amount })),
    subtotal: invoice.subtotal, discountAmount: invoice.discountAmount, taxAmount: invoice.taxAmount,
    total: totalCents / 100, ...paymentDetails(details, today, totalCents),
  };
}

export function receiptHTML(receipt) {
  return `<article class="receipt-sheet${receipt.standalone ? " receipt-standalone" : ""}" aria-label="Payment receipt">
    <header class="receipt-header"><img src="/assets/brand/hmp-logo-header-2026.png" width="160" alt="HMP Luxury Event Services"><div><p class="receipt-eyebrow">Payment receipt</p><h2>${escape(receipt.receiptNumber)}</h2><span class="receipt-paid">${receipt.balance === null ? "Payment received" : receipt.balance === 0 ? "Paid in full" : "Partial payment received"}</span></div></header>
    <div class="receipt-details"><section><h3>Received from</h3><p>${escape(receipt.clientName)}<br>${escape(receipt.clientEmail)}</p>${receipt.eventName ? `<h3>Event</h3><p>${escape(receipt.eventName)}${receipt.eventDate ? `<br>${escape(dateLabel(receipt.eventDate))}` : ""}</p>` : ""}${receipt.eventAddress ? `<h3>Event address</h3><p>${escape(receipt.eventAddress)}</p>` : ""}</section>
    <section><h3>Payment details</h3><dl>${receipt.standalone ? "" : `<div><dt>Invoice</dt><dd>${escape(receipt.invoiceNumber)}</dd></div>`}<div><dt>Receipt issued</dt><dd>${escape(dateLabel(receipt.issuedDate))}</dd></div><div><dt>Payment received</dt><dd>${escape(dateLabel(receipt.paymentDate))}</dd></div><div><dt>Payment method</dt><dd>${escape(receipt.paymentMethod)}</dd></div>${receipt.reference ? `<div><dt>Reference</dt><dd>${escape(receipt.reference)}</dd></div>` : ""}</dl></section></div>
    ${receipt.standalone ? `<section class="receipt-note"><h3>Service / payment description</h3><p>${escape(receipt.serviceDescription)}</p></section>` : `<table class="receipt-services"><thead><tr><th scope="col">Service description</th><th scope="col">Amount</th></tr></thead><tbody>${receipt.items.map(item => `<tr><td>${escape(item.description)}</td><td>${money(item.amount)}</td></tr>`).join("")}</tbody></table>`}
    <dl class="receipt-totals">${receipt.standalone ? (receipt.total === null ? "" : `<div><dt>Service total</dt><dd>${money(receipt.total)}</dd></div>`) : `<div><dt>Subtotal</dt><dd>${money(receipt.subtotal)}</dd></div><div><dt>Discount</dt><dd>-${money(receipt.discountAmount)}</dd></div><div><dt>Tax</dt><dd>${money(receipt.taxAmount)}</dd></div><div><dt>Invoice total</dt><dd>${money(receipt.total)}</dd></div>`}<div class="receipt-total"><dt>Amount paid to date</dt><dd>${money(receipt.amountPaid)}</dd></div>${receipt.balance === null ? "" : `<div><dt>Balance remaining</dt><dd>${money(receipt.balance)}</dd></div>`}</dl>
    ${receipt.note ? `<section class="receipt-note"><h3>Receipt note</h3><p>${escape(receipt.note)}</p></section>` : ""}
    <footer><strong>Thank you for choosing HMP Luxury Event Services.</strong><p>${receipt.standalone ? "This standalone receipt acknowledges the amount paid to date for the service described above." + (receipt.balance === null ? " No service total was supplied; this receipt does not confirm the remaining balance or full payment." : receipt.balance === 0 ? " The stated service total has been paid in full." : " The balance remaining against the stated service total is shown above.") : receipt.balance === 0 ? "This receipt acknowledges full payment of the invoice listed above. No payment is due for this invoice." : "This receipt acknowledges the amount paid to date toward the invoice listed above. The balance remaining is shown above; this invoice is not yet paid in full."}</p><p>info@hmpeds.com · 301-471-0990 · hmpeds.com</p></footer>
  </article>`;
}
