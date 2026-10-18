import { agreementRequest, escape } from "../agreement-ui.mjs";
import { createReceipt, localDate, paymentMethods, receiptHTML } from "../receipt-template.mjs";
import { receiptDraftPayload } from "../receipt-draft.mjs";
import { invoiceStatusLabel, receiptableStatuses } from "../invoice-status.mjs";

const dialog = document.createElement("dialog");
dialog.className = "agreement-dialog receipt-dialog";
dialog.id = "receipt-editor";
dialog.setAttribute("aria-labelledby", "receipt-editor-title");
document.body.append(dialog);
let invoices = [], selected = null, busy = false, dirty = false;
let activeDraft = null;
const $ = selector => dialog.querySelector(selector);
const message = text => { $("#receipt-status").textContent = text; };
const canClose = () => !busy && (!dirty || confirm("Close without saving your latest changes? Choose Cancel, then Save draft to keep them in Drafts → Payment receipts."));
dialog.addEventListener("cancel", event => { if (!canClose()) event.preventDefault(); else dirty = false; });
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });

document.querySelector("#create-receipt").addEventListener("click", () => openReceiptDraft());

export async function openReceiptDraft(draft = null) {
  if (dialog.open) return;
  activeDraft = draft;
  dialog.innerHTML = `<header><div><p>CLIENT RECEIPT</p><h2 id="receipt-editor-title">Payment receipt</h2></div><button class="agreement-button secondary" type="button" id="receipt-close">Close</button></header>
    <p>Choose a sent, partially paid, or fully paid invoice to issue a receipt. Enter the amount actually paid to date, then print or save a PDF to share with the client by email or Messages.</p>
    <p>Save unfinished details privately under Drafts → Payment receipts, even before an invoice is ready. Saving or printing does not send anything, charge the client, or change the invoice's payment status.</p>
    <form id="receipt-form"><label class="agreement-field">Invoice<select id="receipt-invoice" required disabled><option value="">Loading invoices…</option></select></label>
    <p id="receipt-amount-help" hidden></p>
    <div id="receipt-fields"><div class="agreement-grid"><label class="agreement-field">Payment received date<input name="paymentDate" type="date" required max="${localDate()}"></label><label class="agreement-field">Payment method<select name="paymentMethod" required><option value="">Choose a method</option>${paymentMethods.map(method => `<option>${escape(method)}</option>`).join("")}</select></label><label class="agreement-field agreement-wide">Payment reference (optional)<input name="reference" maxlength="120" placeholder="Transaction or check reference - no card or bank account numbers"></label><label class="agreement-field agreement-wide">Client-facing receipt note (optional)<textarea name="note" rows="3" maxlength="1000"></textarea></label></div>
    <label class="agreement-field">Amount paid to date ($)<input name="amountPaid" type="number" inputmode="decimal" min="0.01" step="0.01" required aria-describedby="receipt-amount-help"></label>
    <label class="agreement-checkbox"><input name="confirmed" type="checkbox" required><span>I confirm that the amount paid to date entered above has actually been received.</span></label></div>
    <div class="agreement-actions"><button class="agreement-button secondary" type="button" id="receipt-save-draft" disabled>Save draft</button><button class="agreement-button secondary" type="submit" id="receipt-preview-button" disabled>Preview receipt</button><button class="agreement-button" type="button" id="receipt-print-button" disabled>Print / Save PDF</button></div><p id="receipt-status" class="agreement-status" role="status"></p></form><div id="receipt-preview" hidden></div>`;
  selected = null; dirty = false; busy = false;
  $("#receipt-close").onclick = () => { if (canClose()) { dirty = false; dialog.close(); } };
  $("#receipt-invoice").onchange = () => {
    selected = invoices.find(invoice => invoice.id === $("#receipt-invoice").value) || null;
    $("#receipt-preview-button").disabled = !selected || selected.status === "Draft";
    $("#receipt-print-button").disabled = !selected || selected.status === "Draft";
    $("[name=confirmed]").checked = false;
    $("[name=amountPaid]").max = selected ? String(selected.total) : "";
    $("#receipt-amount-help").hidden = !selected;
    $("#receipt-amount-help").textContent = selected ? `Invoice total: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(selected.total)}. Enter the total received for this invoice so far, including earlier payments—not just the latest installment. The remaining balance is calculated in the receipt preview.` : "";
    clearPreview(); dirty = true;
    if (selected?.status === "Draft") message("You can save this receipt as a draft now. Send the invoice before previewing or issuing the receipt.");
  };
  $("#receipt-form").oninput = () => { dirty = true; clearPreview(); };
  $("#receipt-form").onsubmit = event => { event.preventDefault(); prepare(false); };
  $("#receipt-print-button").onclick = () => { if ($("#receipt-form").reportValidity()) prepare(true); };
  $("#receipt-save-draft").onclick = saveDraft;
  dialog.showModal();
  try {
    const result = await agreementRequest("/api/hmp-invoices");
    invoices = result.invoices.filter(invoice => ["Draft", ...receiptableStatuses].includes(invoice.status) && !invoice.deletedAt);
    $("#receipt-invoice").innerHTML = `<option value="">Choose an invoice (can be added later for a draft)</option>${invoices.map(invoice => `<option value="${escape(invoice.id)}">${escape(invoice.invoiceNumber)} · ${escape(invoice.clientName)} · ${escape(invoiceStatusLabel(invoice.status))}</option>`).join("")}`;
    $("#receipt-invoice").disabled = !invoices.length;
    $("#receipt-save-draft").disabled = false;
    if (draft) {
      $("#receipt-invoice").value = draft.invoiceId || "";
      $("#receipt-invoice").onchange();
      for (const [key, value] of Object.entries(receiptDraftPayload(draft.payload))) $(`[name=${key}]`).value = value;
      dirty = false;
      if (draft.invoiceId && !selected) message("The draft's invoice is no longer available. Your payment details are preserved; choose an eligible invoice before preparing a receipt.");
      else if (selected?.status !== "Draft") message("Draft reopened. Review the amount and confirm payment was received before issuing a receipt.");
    } else message(invoices.length ? "" : "No eligible invoices are available. You can still save an unfinished receipt draft and add an invoice later.");
  } catch (error) {
    $("#receipt-invoice").innerHTML = '<option value="">Invoices unavailable</option>';
    message(error.message);
  }
}

async function saveDraft() {
  if (busy) return;
  const values = Object.fromEntries(new FormData($("#receipt-form")));
  const controls = [...dialog.querySelectorAll("input,select,textarea,button")];
  const previous = controls.map(control => control.disabled);
  busy = true;
  controls.forEach(control => { control.disabled = true; });
  try {
    const payload = receiptDraftPayload(values);
    const { draft } = await agreementRequest("/api/hmp-receipt-drafts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeDraft?.id, revision: activeDraft?.revision, invoiceId: selected?.id || null, payload }),
    });
    activeDraft = draft;
    dirty = false;
    message("Saved privately in Drafts → Payment receipts. Nothing has been sent and the invoice status has not changed.");
    window.dispatchEvent(new Event("hmp-drafts-changed"));
  } catch (error) { message(error.message); }
  finally { busy = false; controls.forEach((control, i) => { control.disabled = previous[i]; }); }
}

function clearPreview() {
  $("#receipt-preview").hidden = true;
  $("#receipt-preview").replaceChildren();
  message("");
}

async function prepare(print) {
  if (busy || !selected) return;
  busy = true;
  const controls = [...dialog.querySelectorAll("input,select,textarea,button")];
  const previous = controls.map(control => control.disabled);
  const values = Object.fromEntries(new FormData($("#receipt-form")));
  controls.forEach(control => { control.disabled = true; });
  try {
    // Re-read the protected invoice endpoint so an outdated or voided invoice cannot be receipted.
    const { invoices: latest } = await agreementRequest("/api/hmp-invoices");
    const invoice = latest.find(item => item.id === selected.id);
    if (!invoice || invoice.deletedAt || invoice.updatedAt !== selected.updatedAt) throw new Error("This invoice has changed. Close and reopen the receipt to review the latest details.");
    const receipt = createReceipt(invoice, { ...values, confirmed: values.confirmed === "on" });
    $("#receipt-preview").innerHTML = receiptHTML(receipt);
    $("#receipt-preview").hidden = false;
    if (print) {
      document.querySelector("#receipt-print")?.remove();
      const section = document.createElement("section");
      section.id = "receipt-print"; section.innerHTML = receiptHTML(receipt);
      document.body.append(section);
      await Promise.all([...section.querySelectorAll("img")].map(img => img.decode().catch(() => {})));
      document.body.classList.add("printing-receipt");
      const title = document.title;
      document.title = `${receipt.receiptNumber} - HMP Payment Receipt`;
      const cleanup = () => { section.remove(); document.body.classList.remove("printing-receipt"); document.title = title; };
      window.addEventListener("afterprint", cleanup, { once: true });
      try { window.print(); } catch (error) { cleanup(); throw error; }
      message("Choose Save as PDF in the print dialog. Share that PDF through the client's Messages attachment button or your email. Nothing has been sent automatically.");
    } else {
      $("#receipt-preview").scrollIntoView({ block: "start" });
      message("Review the receipt below, then choose Print / Save PDF.");
    }
  } catch (error) { clearPreview(); message(error.message); }
  finally { busy = false; controls.forEach((control, i) => { control.disabled = previous[i]; }); }
}
