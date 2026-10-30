import { answersHTML, escape, fieldsHTML } from "./agreement-ui.mjs";
import {richTextHTML} from "./text-formatting.mjs";

export function informationFieldsHTML(fields, values = {}) {
  const paymentIndex = fields.findIndex(field => field.id === "paymentPlatformOne" || field.id === "qrCodeInstructions");
  if (paymentIndex < 0) return fieldsHTML(fields, values);
  // Display guidance also applies to existing unfinished links without rewriting saved snapshots.
  const guidance = `<section class="information-payment-help agreement-wide" aria-label="Digital payment QR-code instructions">
    <h3>Digital payment information for signs</h3>
    <p>Please provide at least two digital transfer platforms and their public payment handles below.</p>
    <h4>How to get your Cash App QR code</h4>
    <ol><li>Open Cash App on your phone.</li><li>Tap your profile icon, then look for QR Code or Scan.</li><li>Open your personal QR code. If the scanner opens, choose your own code rather than scanning someone else’s.</li><li>Take a clear screenshot showing the full QR code and your payment handle.</li></ol>
    <h4>How to get your Venmo QR code</h4>
    <ol><li>Open Venmo on your phone and go to the Me tab.</li><li>Tap the QR-code button on your profile picture.</li><li>Select Venmo me to display your personal code—not Show to pay.</li><li>Take a clear screenshot, or use the share button to save or send your code.</li></ol>
    <p>Send the QR-code screenshots through your HMP message thread in the client portal or by text to <a href="sms:+13014710990">301-471-0990</a>. Include the full code and confirm the displayed name and payment handle belong to the intended recipient.</p>
    <p>Only share public payment handles and receiving QR codes—never bank account numbers, passwords, PINs, or login codes. App layouts may vary by version.</p>
  </section>`;
  return fieldsHTML(fields.slice(0, paymentIndex), values) + guidance + fieldsHTML(fields.slice(paymentIndex), values);
}

export function informationIntroductionHTML(record) {
  return record.snapshot.description ? record.snapshot.textFormatting?.description ? `<div>${richTextHTML(record.snapshot.description,record.snapshot.textFormatting.description)}</div>` : `<p style="white-space:pre-line">${escape(record.snapshot.description)}</p>` : "";
}
export function informationPreviewHTML(record) {
  return `<h2>${escape(record.snapshot.title)}</h2><p>${escape(record.clientName || "Client name")}${record.adminAnswers?.eventName ? ` · ${escape(record.adminAnswers.eventName)}` : ""}</p>${informationIntroductionHTML(record)}${record.status === "Completed" ? informationSummary(record, false) : `<fieldset disabled class="information-preview-fields"><legend>Client questions</legend><p>* Required when the client submits.</p><div class="agreement-grid">${informationFieldsHTML(record.snapshot.clientFields, {email:record.clientEmail || "",...record.clientAnswers})}</div><p>Only share public payment handles or QR codes—never bank account numbers, passwords, or login codes.</p></fieldset>`}`;
}
export function previewInformation(record) {
  const preview = document.createElement("dialog");
  preview.className = "agreement-dialog information-preview";
  preview.setAttribute("aria-label", "Client form preview");
  preview.innerHTML = `<header><p>Preview only — nothing is saved or sent.</p><button type="button" class="agreement-button secondary">Close preview</button></header>${informationPreviewHTML(record)}`;
  preview.querySelector("button").onclick = () => preview.close();
  preview.addEventListener("close", () => preview.remove(), {once:true});
  document.body.append(preview);
  preview.showModal();
}
export function informationSummary(record, showTitle = true) {
  return `${showTitle ? `<h2>${escape(record.snapshot.title)}</h2>${record.snapshot.subtitle ? `<p>${escape(record.snapshot.subtitle)}</p>` : ""}` : ""}<p>${escape(record.clientName)} · ${escape(record.clientEmail)}</p>${answersHTML(record.snapshot.adminFields, record.adminAnswers,record.snapshot.answerFormatting)}<h3>Client responses</h3>${record.completedAt ? answersHTML(record.snapshot.clientFields, record.clientAnswers) : "<p>Awaiting the client’s submission.</p>"}<p>${record.completedAt ? `Submitted: ${escape(new Date(record.completedAt).toLocaleString())}` : "Not submitted yet"}</p>`;
}
export function printInformation(record) {
  document.querySelector("#agreement-print")?.remove();
  const section = document.createElement("section");
  section.id = "agreement-print";
  section.innerHTML = `<h1>HMP Luxury Event Services</h1>${informationIntroductionHTML(record)}${informationSummary(record)}`;
  document.body.append(section);
  document.body.classList.add("printing-agreement");
  window.addEventListener("afterprint", () => {section.remove(); document.body.classList.remove("printing-agreement");}, {once:true});
  window.print();
}
