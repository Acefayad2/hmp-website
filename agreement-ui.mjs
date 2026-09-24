export const escape = (value = "") => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
export function fieldsHTML(fields, values = {}, prefix = "answer", required = true) {
  return fields.map(field => {
    const id = `${prefix}-${field.id}`, value = values[field.id] || "";
    const attrs = `id="${id}" name="${field.id}" ${required && field.required ? "required" : ""}`;
    let input;
    if (field.options) input = `<select ${attrs}><option value="">Choose an option</option>${field.options.map(option => `<option ${value === option ? "selected" : ""}>${escape(option)}</option>`).join("")}</select>`;
    else if (field.type === "textarea") input = `<textarea ${attrs} rows="3" maxlength="5000">${escape(value)}</textarea>`;
    else input = `<input ${attrs} type="${field.type === "money" ? "number" : field.type}" ${["number", "money"].includes(field.type) ? `min="0" max="10000000" step="${field.type === "money" ? "0.01" : "1"}"` : 'maxlength="500"'} value="${escape(value)}">`;
    return `<label class="agreement-field ${field.type === "textarea" ? "agreement-wide" : ""}" for="${id}"><span>${escape(field.label)}${field.required ? " *" : " (optional)"}</span>${input}</label>`;
  }).join("");
}
export function answersHTML(fields, values = {}) {
  return `<dl class="agreement-answers">${fields.map(field => {
    const value = values[field.id];
    const formatted = value !== undefined && value !== "" && field.type === "money" ? new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(Number(value)) : value || "Not specified";
    return `<div><dt>${escape(field.label)}</dt><dd>${escape(formatted)}</dd></div>`;
  }).join("")}</dl>`;
}
export const termsHTML = snapshot => snapshot.pages.map((page, i) => `<section class="agreement-terms-page"><h3>Agreement text · ${i + 1} / ${snapshot.pages.length}</h3><div>${escape(page)}</div></section>`).join("");
export const completionHTML = agreement => `<section class="agreement-panel"><h2>Completed client details</h2>${answersHTML(agreement.snapshot.clientFields, agreement.clientAnswers)}<h3>Electronic signature</h3><p class="agreement-signature">${escape(agreement.signature?.name)}</p><p>${escape(agreement.signature?.consent)}</p><p>Signed: ${escape(agreement.completedAt)}<br>HMP signed: ${escape(agreement.adminAnswers.hmpSignedAt)}</p><p class="agreement-fingerprint">Record ID: ${escape(agreement.id)}<br>SHA-256 record fingerprint: ${escape(agreement.recordHash)}</p></section>`;
export function printAgreement(agreement) {
  document.querySelector("#agreement-print")?.remove();
  const section = document.createElement("section");
  section.id = "agreement-print";
  section.innerHTML = `<h1>${escape(agreement.snapshot.title)}</h1><p>HMP Luxury Event Services · ${escape(agreement.status)} · Version ${escape(agreement.snapshot.version)}</p><p>Prepared for ${escape(agreement.clientName)} (${escape(agreement.clientEmail)})</p><p>The completed details below supply the corresponding blanks in the agreement text. Event-date placeholders refer to the event date supplied below.</p><h2>HMP service details</h2>${answersHTML(agreement.snapshot.adminFields, agreement.adminAnswers)}${agreement.status === "Completed" ? completionHTML(agreement) : "<p>Unsigned preview — not a completed agreement.</p>"}<h2>Agreement terms</h2>${termsHTML(agreement.snapshot)}`;
  document.body.append(section);
  document.body.classList.add("printing-agreement");
  window.addEventListener("afterprint", () => {section.remove(); document.body.classList.remove("printing-agreement");}, {once:true});
  window.print();
}
export async function agreementRequest(path, options = {}) {
  const response = await fetch(path, {credentials:"same-origin", cache:"no-store", ...options});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || "The form could not be loaded."); error.data = data; throw error; }
  return data;
}
