export const escape = (value = "") => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
import { formattedPageHTML } from "./agreement-formatting.mjs";
import { signatureDrawingHTML } from "./signature-pad.mjs";
const drawingsHTML = signature => Object.entries(signature?.drawings || {}).map(([key,drawing]) => {
  const label = {signatureName:"Signer",representativeOneSignature:"First representative",representativeTwoSignature:"Second representative"}[key];
  if (!label) return "";
  try {return `<div class="signature-record"><h3>${label} — drawn signature</h3>${signatureDrawingHTML(drawing.strokes)}<p>${escape(drawing.consent)}</p></div>`;} catch {return "<p>Signature drawing could not be displayed. Contact HMP for the original record.</p>";}
}).join("");

export function nativeFormIssues(form) {
  return [...form.elements].filter(input => input.willValidate && !input.validity.valid).map(input => {
    const label = input.labels?.[0];
    const name = label?.querySelector("span")?.textContent || [...(label?.childNodes || [])].find(node => node.nodeType === 3 && node.textContent.trim())?.textContent.trim() || input.name || "Field";
    return {field:input.name, id:input.id, ...(input.dataset.agreementPage !== undefined ? {pageIndex:Number(input.dataset.agreementPage)} : {}), message:`${name}: ${input.validationMessage}`};
  });
}

export function showFormIssues(form, issues) {
  form.querySelector("[data-validation-summary]")?.remove();
  form.querySelectorAll('[data-validation-invalid]').forEach(input => {
    input.removeAttribute("aria-invalid"); input.removeAttribute("data-validation-invalid");
  });
  if (!issues.length) return;
  const summary = document.createElement("section");
  summary.className = "agreement-validation";
  summary.dataset.validationSummary = "";
  summary.setAttribute("role", "alert"); summary.tabIndex = -1;
  const heading = document.createElement("strong");
  heading.textContent = `Please fix ${issues.length === 1 ? "this item" : `these ${issues.length} items`} before continuing:`;
  summary.append(heading);
  for (const help of new Set(issues.map(issue => issue.help).filter(Boolean))) {
    const paragraph = document.createElement("p"); paragraph.textContent = help; summary.append(paragraph);
  }
  const list = document.createElement("ul");
  issues.forEach(issue => {
    const input = [...form.querySelectorAll("input,textarea,select,[data-agreement-editor]")].find(input =>
      Number.isInteger(issue.pageIndex) ? (input.dataset.agreementPage ?? input.dataset.agreementEditor) === String(issue.pageIndex) :
        (issue.id && input.id === issue.id) || (issue.field && input.name === issue.field));
    const item = document.createElement("li");
    const link = document.createElement(input ? "button" : "span");
    link.textContent = issue.message;
    if (input) {
      input.setAttribute("aria-invalid", "true"); input.dataset.validationInvalid = "";
      link.type = "button";
      link.addEventListener("click", () => {
        let parent = input.parentElement;
        while (parent && parent !== form) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
        input.focus(); input.scrollIntoView({block:"center"});
        if (Number.isInteger(issue.start) && typeof input.setSelectionRange === "function") input.setSelectionRange(issue.start, issue.end);
      });
    }
    item.append(link); list.append(item);
  });
  summary.append(list); form.prepend(summary); summary.focus(); summary.scrollIntoView({block:"start"});
}

export function checkFormInputs(form) {
  const issues = nativeFormIssues(form);
  showFormIssues(form, issues);
  return !issues.length;
}

// Native validation can stop submission before a form's submit handler runs.
// Capture it once so every Admin form gets the same visible, linked summary.
export function installValidationSummaries(root) {
  const pending = new WeakSet();
  root.addEventListener("invalid", event => {
    const form = event.target.form;
    if (!form) return;
    event.preventDefault();
    if (pending.has(form)) return;
    pending.add(form);
    queueMicrotask(() => {pending.delete(form); showFormIssues(form, nativeFormIssues(form));});
  }, true);
}
export function fieldsHTML(fields, values = {}, prefix = "answer", required = true) {
  return fields.map(field => {
    const id = `${prefix}-${field.id}`, value = values[field.id] ?? field.default ?? "";
    const attrs = `id="${id}" name="${field.id}" ${required && field.required ? "required" : ""} ${field.calculated ? 'readonly aria-readonly="true"' : ""}`;
    let input;
    if (field.options) input = `<select ${attrs}><option value="">Choose an option</option>${field.options.map(option => `<option ${value === option ? "selected" : ""}>${escape(option)}</option>`).join("")}</select>`;
    else if (field.type === "textarea") input = `<textarea ${attrs} rows="3" maxlength="5000">${escape(value)}</textarea>`;
    else input = `<input ${attrs} type="${["money", "decimal"].includes(field.type) ? "number" : field.type}" ${["number", "money", "decimal"].includes(field.type) ? `min="${field.id === "serviceHours" ? "4" : "0"}" max="10000000" step="${field.type === "number" ? "1" : "0.01"}"` : 'maxlength="500"'} value="${escape(value)}">`;
    return `<label class="agreement-field ${field.type === "textarea" || field.id === "serviceHours" ? "agreement-wide" : ""}" for="${id}"><span>${escape(field.label)}${field.calculated ? " (calculated)" : field.required ? " *" : " (optional)"}</span>${field.help ? `<small>${escape(field.help)}</small>` : ""}${input}</label>`;
  }).join("");
}
export function answersHTML(fields, values = {}) {
  return `<dl class="agreement-answers">${fields.map(field => {
    const value = values[field.id];
    const formatted = value !== undefined && value !== "" && field.type === "money" ? new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(Number(value)) : value || "Not specified";
    return `<div><dt>${escape(field.label)}</dt><dd>${escape(formatted)}</dd></div>`;
  }).join("")}</dl>`;
}
export const termsHTML = snapshot => snapshot.pages.map((page, i) => `<section class="agreement-terms-page"><h3>Agreement text · ${i + 1} / ${snapshot.pages.length}</h3><div>${snapshot.pageFormatting?.[i] ? formattedPageHTML(page,snapshot.pageFormatting[i]) : escape(page)}</div></section>`).join("");
export const completionHTML = agreement => `<section class="agreement-panel"><h2>Completed client details</h2>${answersHTML(agreement.snapshot.clientFields, agreement.clientAnswers)}<h3>${agreement.snapshot.signatureMode === "on-site-three-signatures" ? "HMP attendant electronic signature" : "Electronic signature"}</h3><p class="agreement-signature">${escape(agreement.signature?.name)}</p><p>${escape(agreement.signature?.consent)}</p>${drawingsHTML(agreement.signature)}<p>Signed: ${escape(agreement.completedAt)}${agreement.adminAnswers.hmpSignedAt ? `<br>HMP signed: ${escape(agreement.adminAnswers.hmpSignedAt)}` : ""}</p><p class="agreement-fingerprint">Record ID: ${escape(agreement.id)}<br>SHA-256 record fingerprint: ${escape(agreement.recordHash)}</p></section>`;
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
