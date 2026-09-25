import { agreementRequest, escape } from "../agreement-ui.mjs";
import { createReceipt, localDate, paymentMethods, receiptHTML } from "../receipt-template.mjs";

const dialog = document.createElement("dialog");
dialog.className = "agreement-dialog receipt-dialog";
dialog.id = "receipt-editor";
dialog.setAttribute("aria-labelledby", "receipt-editor-title");
document.body.append(dialog);
let invoices = [], selected = null, busy = false, dirty = false;
const $ = selector => dialog.querySelector(selector);
const message = text => { $("#receipt-status").textContent = text; };
const canClose = () => !busy && (!dirty || confirm("Close this receipt? Save a PDF first if you need to keep it. Payment details entered here are not stored."));
dialog.addEventListener("cancel", event => { if (!canClose()) event.preventDefault(); else dirty = false; });
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });

document.querySelector("#create-receipt").addEventListener("click", async () => {
  dialog.innerHTML = `<header><div><p>CLIENT RECEIPT</p><h2 id="receipt-editor-title">Payment receipt</h2></div><button class="agreement-button secondary" type="button" id="receipt-close">Close</button></header>
    <p>Choose an invoice already saved as Paid. Confirm the payment details, then print or save a PDF to share with the client by email or Messages.</p>
    <p>Payment details entered here are not stored. Keep the PDF for your records. This does not charge the client or change the invoice.</p>
    <form id="receipt-form"><label class="agreement-field">Paid invoice<select id="receipt-invoice" required disabled><option value="">Loading paid invoices…</option></select></label>
    <div id="receipt-fields" hidden><div class="agreement-grid"><label class="agreement-field">Payment received date<input name="paymentDate" type="date" required max="${localDate()}"></label><label class="agreement-field">Payment method<select name="paymentMethod" required><option value="">Choose a method</option>${paymentMethods.map(method => `<option>${escape(method)}</option>`).join("")}</select></label><label class="agreement-field agreement-wide">Payment reference (optional)<input name="reference" maxlength="120" placeholder="Transaction or check reference - no card or bank account numbers"></label><label class="agreement-field agreement-wide">Client-facing receipt note (optional)<textarea name="note" rows="3" maxlength="1000"></textarea></label></div>
    <label class="agreement-checkbox"><input name="confirmed" type="checkbox" required><span>I confirm that the full invoice amount has been received.</span></label></div>
    <div class="agreement-actions"><button class="agreement-button secondary" type="submit" id="receipt-preview-button" disabled>Preview receipt</button><button class="agreement-button" type="button" id="receipt-print-button" disabled>Print / Save PDF</button></div><p id="receipt-status" class="agreement-status" role="status"></p></form><div id="receipt-preview" hidden></div>`;
  selected = null; dirty = false; busy = false;
  $("#receipt-close").onclick = () => { if (canClose()) { dirty = false; dialog.close(); } };
  $("#receipt-invoice").onchange = () => {
    selected = invoices.find(invoice => invoice.id === $("#receipt-invoice").value) || null;
    $("#receipt-fields").hidden = !selected;
    $("#receipt-preview-button").disabled = !selected;
    $("#receipt-print-button").disabled = !selected;
    $("#receipt-fields").querySelectorAll("input,select,textarea").forEach(field => { if (field.type === "checkbox") field.checked = false; else field.value = ""; });
    clearPreview(); dirty = false;
  };
  $("#receipt-form").oninput = () => { dirty = true; clearPreview(); };
  $("#receipt-form").onsubmit = event => { event.preventDefault(); prepare(false); };
  $("#receipt-print-button").onclick = () => { if ($("#receipt-form").reportValidity()) prepare(true); };
  dialog.showModal();
  try {
    const result = await agreementRequest("/api/hmp-invoices");
    invoices = result.invoices.filter(invoice => invoice.status === "Paid");
    $("#receipt-invoice").innerHTML = `<option value="">Choose a paid invoice</option>${invoices.map(invoice => `<option value="${escape(invoice.id)}">${escape(invoice.invoiceNumber)} · ${escape(invoice.clientName)}</option>`).join("")}`;
    $("#receipt-invoice").disabled = !invoices.length;
    message(invoices.length ? "" : "No paid invoices yet. In Invoices & Contracts, open the invoice, set its status to Paid after payment is received, and save it. Then return here.");
  } catch (error) {
    $("#receipt-invoice").innerHTML = '<option value="">Paid invoices unavailable</option>';
    message(error.message);
  }
});

function clearPreview() {
  $("#receipt-preview").hidden = true;
  $("#receipt-preview").replaceChildren();
  message("");
}

async function prepare(print) {
  if (busy || !selected) return;
  busy = true;
  const controls = [...dialog.querySelectorAll("input,select,textarea,button")];
  const values = Object.fromEntries(new FormData($("#receipt-form")));
  controls.forEach(control => { control.disabled = true; });
  try {
    // Re-read the protected invoice endpoint so an outdated or voided invoice cannot be receipted.
    const { invoices: latest } = await agreementRequest("/api/hmp-invoices");
    const invoice = latest.find(item => item.id === selected.id);
    if (!invoice || invoice.updatedAt !== selected.updatedAt) throw new Error("This invoice has changed. Close and reopen the receipt to review the latest details.");
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
  finally { busy = false; controls.forEach(control => { control.disabled = false; }); }
}
