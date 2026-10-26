import { agreementRequest, answersHTML, completionHTML, escape, fieldsHTML, printAgreement, termsHTML, checkFormInputs, showFormIssues } from "./agreement-ui.mjs";
import { requiresSecondRepresentative, secondRepresentativeFields, validateAnswers } from "./agreement-schema.mjs";
import { renderInformationForm } from "./information-client.mjs?v=20261020-intake-heading";
import { mountSignaturePad } from "./signature-pad.mjs";
import {draftContext, draftFields, readDraft, saveDraft, clearDraft} from "./agreement-draft.mjs";
import {expiryLabel} from "./document-expiry.mjs";
const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
const message = document.querySelector("#agreement-message"), content = document.querySelector("#agreement-content");
let agreement, consentText, draft, draftNotice = "", dirty = false, busy = false;
const headers = {Authorization:`Bearer ${token}`, "Content-Type":"application/json"};
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
function render() {
  document.querySelector("#agreement-title").textContent = agreement.snapshot.title;
  const completed = agreement.status === "Completed";
  const onSite = agreement.snapshot.signatureMode === "on-site-three-signatures";
  let savedDraft;
  if (draft && !completed) {
    try { savedDraft = readDraft(localStorage, draft); } catch { draftNotice = "Draft storage is unavailable or unreadable. Keep this page open; entries have not been restored."; }
  }
  const prefill = {clientName:agreement.clientName, email:agreement.clientEmail, ...savedDraft?.values};
  content.hidden = false;
  content.innerHTML = `<p>Prepared for ${escape(agreement.clientName)} · Form version ${escape(agreement.snapshot.version)}</p><p>${onSite ? "Complete this verification together on the same device. Each designated representative should personally type their name to sign, then the HMP attendant signs and submits." : "Review the terms and HMP service details, then complete your information below. Your answers supply the corresponding blanks in this agreement; event-date placeholders refer to your event date."}</p>
    ${onSite ? "" : `<details class="agreement-panel" open><summary>Agreement terms — please read before signing</summary>${termsHTML(agreement.snapshot)}</details>`}
    ${agreement.snapshot.adminFields.length ? `<section class="agreement-panel"><h2>HMP service details</h2>${answersHTML(agreement.snapshot.adminFields, agreement.adminAnswers)}</section>` : ""}
    ${completed ? completionHTML(agreement) : `<form id="client-agreement-form" class="agreement-panel"><h2>${onSite ? "On-site verification" : "Your information"}</h2><p>* Required fields. Nothing is submitted until all signers are ready.</p><div class="agreement-grid">${fieldsHTML(agreement.snapshot.clientFields, prefill)}</div>${onSite ? `<div class="agreement-actions"><button class="agreement-button secondary" type="button" id="save-agreement-draft">Save draft</button></div><p>Save unfinished event details, names and amounts on this browser only. Drafts can be reopened for up to 24 hours or until this link expires. Clear this site’s browser data after using a shared device. Reopen this same private link on this device and browser to continue. Signatures, initials, signing dates and consent are not saved. Shared-device users with this link may see the draft. Nothing is sent to HMP until Sign &amp; submit.</p><p id="draft-status" class="agreement-status" role="status"></p>` : ""}${onSite ? `<details class="agreement-panel"><summary>Review original form terms before signing</summary>${termsHTML(agreement.snapshot)}</details>` : ""}<h2>Review & sign</h2>${onSite ? `<label class="agreement-checkbox"><input name="representativeOneConsent" type="checkbox" required><span>The first designated representative personally typed their matching name as an electronic signature.</span></label><label class="agreement-checkbox"><input name="representativeTwoConsent" type="checkbox" required><span>The second designated representative personally typed their matching name as an electronic signature.</span></label>` : ""}<label class="agreement-field" for="signature-name">${onSite ? "HMP money attendant: type your full name to sign" : "Type your full name"}<input id="signature-name" name="signatureName" autocomplete="name" required minlength="2" maxlength="200"></label><label class="agreement-checkbox"><input name="consent" type="checkbox" required><span>${escape(consentText)}</span></label><p>Your typed signatures, answers, document version, submission time, and browser information will be recorded. Once submitted, the signed record cannot be edited.</p><button class="agreement-button" type="submit">Sign & submit form</button><p id="signature-status" class="agreement-status" role="status"></p></form>`}
    <div class="agreement-actions"><button type="button" class="agreement-button secondary" id="print-agreement">${completed ? "Print / save completed form" : "Print agreement terms"}</button></div>`;
  document.querySelector("#print-agreement").onclick = () => printAgreement(agreement);
  const form = document.querySelector("#client-agreement-form");
  if (form && onSite) {
    const grid = form.querySelector(".agreement-grid");
    // Group existing controls without changing field names, validation or saved records.
    for (const [title, names] of [
      ["First designated representative", ["representativeOneName", "representativeOneSignature", "representativeOneDate"]],
      ["Second designated representative", ["representativeTwoName", "representativeTwoSignature", "representativeTwoDate"]],
      ["HMP money attendant", ["attendantName", "attendantDate", "signatureName"]]
    ]) {
      const group = document.createElement("fieldset");
      group.className = "agreement-signer-group agreement-wide";
      const legend = document.createElement("legend");
      legend.textContent = title;
      const fields = document.createElement("div");
      fields.className = "agreement-grid";
      for (const name of names) {
        const label = form.elements.namedItem(name)?.closest("label");
        if (label) {
          if (name === "signatureName") label.classList.add("agreement-wide");
          fields.append(label);
        }
      }
      if (fields.children.length) {
        group.append(legend, fields);
        grid.append(group);
      }
    }
  }
  if (agreement.expiresAt) { const expiry=document.createElement("p"); expiry.textContent=`Link expires: ${expiryLabel(agreement.expiresAt)}.`; content.prepend(expiry); }
  if (form) form.noValidate = true;
  let signatureDirty = false;
  const draftStatus = document.querySelector("#draft-status");
  if (draftStatus) draftStatus.textContent = draftNotice || (savedDraft ? "Saved draft restored on this browser. Review all entries and complete fresh signatures, initials, signing dates and consent before submitting." : "No draft saved yet.");
  document.querySelector("#save-agreement-draft")?.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    const values = Object.fromEntries(new FormData(form));
    form.querySelectorAll("input,select,textarea,button").forEach(item => item.disabled = true);
    draftStatus.textContent = "Checking the form and saving this browser’s draft…";
    try {
      const latest = await agreementRequest("/api/hmp-agreement", {headers});
      const current = await draftContext(latest.agreement, token);
      if (!draft || !current || current.key !== draft.key || current.fingerprint !== draft.fingerprint) throw new Error("This form changed or was completed. Reopen the link before saving; your current entries remain here.");
      const record = saveDraft(localStorage, current, values);
      const savedIds = new Set(draftFields(agreement.snapshot).map(field => field.id));
      dirty = Object.entries(values).some(([key,value]) => !savedIds.has(key) && Boolean(value)) || signatureDirty;
      draftStatus.textContent = `Draft saved on this browser until ${expiryLabel(new Date(record.expiresAt).toISOString())}. Nothing was submitted. Signatures, initials, signing dates and consent must be completed again after reopening.`;
    } catch (error) { draftStatus.textContent = `Draft was not saved. ${error.message || "Browser storage is unavailable."} Keep this page open and try again.`; }
    finally { busy = false; form.querySelectorAll("input,select,textarea,button").forEach(item => item.disabled = false); }
  });
  const pads = {};
  if (form) {
    for (const [key,label] of [["signatureName",onSite ? "HMP attendant" : "Client"], ...(onSite ? [["representativeOneSignature","First representative"],["representativeTwoSignature","Second representative"]] : [])]) {
      pads[key]=mountSignaturePad(form.elements.namedItem(key),label,()=>{dirty=true; signatureDirty=true;});
    }
  }
  if (form && onSite && agreement.snapshot.optionalSecondRepresentative === true) {
    const hint = document.createElement("p");
    hint.textContent = "The second designated representative is optional. Leave their name, signature and date blank if not needed. If included, complete all three fields and their signature consent. Either designated representative may initial receipt and reconciliation.";
    form.querySelector(".agreement-grid").before(hint);
    const consent = form.elements.namedItem("representativeTwoConsent");
    consent.closest("label").querySelector("span").append(" (Only if a second representative is included.)");
    const syncSecondRepresentative = () => {
      const required = requiresSecondRepresentative(agreement.snapshot, Object.fromEntries(new FormData(form)), consent.checked);
      for (const id of secondRepresentativeFields) {
        const input = form.elements.namedItem(id);
        input.required = required;
        input.closest("label").querySelector("span").textContent = agreement.snapshot.clientFields.find(field => field.id === id).label + (required ? " *" : " (optional)");
      }
      consent.required = required;
    };
    syncSecondRepresentative();
    form.addEventListener("input", syncSecondRepresentative);
  }
  form?.addEventListener("input", () => { dirty = true; });
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !checkFormInputs(form)) return;
    const status = document.querySelector("#signature-status");
    try {
      const values = Object.fromEntries(new FormData(form));
      const answers = validateAnswers(agreement.snapshot.clientFields, values);
      const signatureDrawings = Object.fromEntries(Object.entries(pads).map(([key,pad])=>[key,pad.read()]).filter(([,value])=>value));
      if (!confirm("Submit your electronic signature? Your answers will be locked after submission.")) return;
      busy = true; form.querySelectorAll("input,select,textarea,button").forEach(item => item.disabled = true);
      status.textContent = "Saving your signed form…";
      const data = await agreementRequest("/api/hmp-agreement", {method:"POST", headers, body:JSON.stringify({agreementId:agreement.id, answers, signatureDrawings, signatureName:values.signatureName, consent:values.consent === "on", ...(onSite ? {representativeOneConsent:values.representativeOneConsent === "on", representativeTwoConsent:values.representativeTwoConsent === "on"} : {})})});
      try { clearDraft(localStorage, draft); draftNotice = ""; } catch { draftNotice = "The signed form is saved, but this browser could not remove its older local draft. Clear site data when finished on a shared device."; }
      agreement = data.agreement; dirty = false; render();
      message.classList.add("success"); message.textContent = "Your signed form has been saved and is available to HMP. You can print or save your copy below.";
      if (draftNotice) message.textContent += " " + draftNotice;
      message.scrollIntoView({block:"center"});
    } catch (error) { status.textContent = error.message; showFormIssues(form, error.issues || error.data?.issues || [{message:error.message}]); }
    finally { busy = false; form.querySelectorAll("input,select,textarea,button").forEach(item => item.disabled = false); }
  });
}
async function load() {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Please open the private form link sent by HMP.");
    const data = await agreementRequest("/api/hmp-agreement", {headers});
    agreement = data.agreement; consentText = data.signingConsent;
    if (agreement.snapshot.kind === "information") {renderInformationForm(agreement, headers); return;}
    try {
      // A completed form must never reopen an editable draft.
      const source = {...agreement, status:"Sent"};
      draft = await draftContext(source, token);
      if (agreement.status === "Completed") clearDraft(localStorage, draft);
    } catch { draftNotice = "Draft storage is unavailable. Keep this page open until you finish."; }
    render(); message.textContent = agreement.status === "Completed" ? "This form has already been completed. Your signed copy is below." : "";
  } catch (error) { message.textContent = error.message; }
}
load();
