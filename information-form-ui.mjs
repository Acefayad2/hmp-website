import { answersHTML, escape, signatureDisplayHTML } from "./agreement-ui.mjs";
export function informationSummary(record, showTitle = true) {
  return `${showTitle ? `<h2>${escape(record.snapshot.title)}</h2>` : ""}<p>${escape(record.clientName)} · ${escape(record.clientEmail)}</p>${answersHTML(record.snapshot.adminFields, record.adminAnswers)}<h3>Client responses</h3>${record.completedAt ? answersHTML(record.snapshot.clientFields, record.clientAnswers) : "<p>Awaiting the client’s submission.</p>"}${signatureDisplayHTML(record.signature)}<p>${record.completedAt ? `Submitted: ${escape(new Date(record.completedAt).toLocaleString())}` : "Not submitted yet"}</p>${record.recordHash ? `<p class="agreement-fingerprint">Record ID: ${escape(record.id)}<br>SHA-256 record fingerprint: ${escape(record.recordHash)}</p>` : ""}`;
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
