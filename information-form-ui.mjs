import { answersHTML, escape, fieldsHTML } from "./agreement-ui.mjs";

export function informationIntroductionHTML(record) {
  return record.snapshot.description ? `<p style="white-space:pre-line">${escape(record.snapshot.description)}</p>` : "";
}
export function informationPreviewHTML(record) {
  return `<h2>${escape(record.snapshot.title)}</h2><p>${escape(record.clientName || "Client name")}${record.adminAnswers?.eventName ? ` · ${escape(record.adminAnswers.eventName)}` : ""}</p>${informationIntroductionHTML(record)}${record.status === "Completed" ? informationSummary(record, false) : `<fieldset disabled class="information-preview-fields"><legend>Client questions</legend><p>* Required when the client submits.</p><div class="agreement-grid">${fieldsHTML(record.snapshot.clientFields, {email:record.clientEmail || "",...record.clientAnswers})}</div><p>Only share public payment handles or QR codes—never bank account numbers, passwords, or login codes.</p></fieldset>`}`;
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
  return `${showTitle ? `<h2>${escape(record.snapshot.title)}</h2>${record.snapshot.subtitle ? `<p>${escape(record.snapshot.subtitle)}</p>` : ""}` : ""}<p>${escape(record.clientName)} · ${escape(record.clientEmail)}</p>${answersHTML(record.snapshot.adminFields, record.adminAnswers)}<h3>Client responses</h3>${record.completedAt ? answersHTML(record.snapshot.clientFields, record.clientAnswers) : "<p>Awaiting the client’s submission.</p>"}<p>${record.completedAt ? `Submitted: ${escape(new Date(record.completedAt).toLocaleString())}` : "Not submitted yet"}</p>`;
}
export function printInformation(record) {
  document.querySelector("#agreement-print")?.remove();
  const section = document.createElement("section");
  section.id = "agreement-print";
  section.innerHTML = `<h1>HMP Luxury Event Services</h1>${informationSummary(record)}`;
  document.body.append(section);
  document.body.classList.add("printing-agreement");
  window.addEventListener("afterprint", () => {section.remove(); document.body.classList.remove("printing-agreement");}, {once:true});
  window.print();
}
