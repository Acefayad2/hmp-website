import { agreementRequest, answersHTML, completionHTML, escape, fieldsHTML, printAgreement, termsHTML, checkFormInputs, showFormIssues } from "./agreement-ui.mjs";
import { requiresSecondRepresentative, secondRepresentativeFields, validateAnswers } from "./agreement-schema.mjs";
import { renderInformationForm } from "./information-client.mjs?v=20261020-intake-heading";
import { mountSignaturePad } from "./signature-pad.mjs";
const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
const message = document.querySelector("#agreement-message"), content = document.querySelector("#agreement-content");
let agreement, consentText, dirty = false, busy = false;
const headers = {Authorization:`Bearer ${token}`, "Content-Type":"application/json"};
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
function render() {
  document.querySelector("#agreement-title").textContent = agreement.snapshot.title;
  const completed = agreement.status === "Completed";
  const onSite = agreement.snapshot.signatureMode === "on-site-three-signatures";
  const prefill = {clientName:agreement.clientName, email:agreement.clientEmail};
  content.hidden = false;
  content.innerHTML = `<p>Prepared for ${escape(agreement.clientName)} · Form version ${escape(agreement.snapshot.version)}</p><p>${onSite ? "Complete this verification together on the same device. Each designated representative should personally type their name to sign, then the HMP attendant signs and submits." : "Review the terms and HMP service details, then complete your information below. Your answers supply the corresponding blanks in this agreement; event-date placeholders refer to your event date."}</p>
    <details class="agreement-panel" open><summary>${onSite ? "Money bank verification text" : "Agreement terms — please read before signing"}</summary>${termsHTML(agreement.snapshot)}</details>
    ${agreement.snapshot.adminFields.length ? `<section class="agreement-panel"><h2>HMP service details</h2>${answersHTML(agreement.snapshot.adminFields, agreement.adminAnswers)}</section>` : ""}
    ${completed ? completionHTML(agreement) : `<form id="client-agreement-form" class="agreement-panel"><h2>${onSite ? "On-site verification" : "Your information"}</h2><p>* Required fields. Nothing is submitted until all signers are ready.</p><div class="agreement-grid">${fieldsHTML(agreement.snapshot.clientFields, prefill)}</div><h2>Review & sign</h2>${onSite ? `<label class="agreement-checkbox"><input name="representativeOneConsent" type="checkbox" required><span>The first designated representative personally typed their matching name as an electronic signature.</span></label><label class="agreement-checkbox"><input name="representativeTwoConsent" type="checkbox" required><span>The second designated representative personally typed their matching name as an electronic signature.</span></label>` : ""}<label class="agreement-field" for="signature-name">${onSite ? "HMP money attendant: type your full name to sign" : "Type your full name"}<input id="signature-name" name="signatureName" autocomplete="name" required minlength="2" maxlength="200"></label><label class="agreement-checkbox"><input name="consent" type="checkbox" required><span>${escape(consentText)}</span></label><p>Your typed signatures, answers, document version, submission time, and browser information will be recorded. Once submitted, the signed record cannot be edited.</p><button class="agreement-button" type="submit">Sign & submit form</button><p id="signature-status" class="agreement-status" role="status"></p></form>`}
    <div class="agreement-actions"><button type="button" class="agreement-button secondary" id="print-agreement">${completed ? "Print / save completed form" : "Print agreement terms"}</button></div>`;
  document.querySelector("#print-agreement").onclick = () => printAgreement(agreement);
  const form = document.querySelector("#client-agreement-form");
  if (form) form.noValidate = true;
  const pads = {};
  if (form) {
    for (const [key,label] of [["signatureName",onSite ? "HMP attendant" : "Client"], ...(onSite ? [["representativeOneSignature","First representative"],["representativeTwoSignature","Second representative"]] : [])]) {
      pads[key]=mountSignaturePad(form.elements.namedItem(key),label,()=>{dirty=true;});
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
      agreement = data.agreement; dirty = false; render();
      message.classList.add("success"); message.textContent = "Your signed form has been saved and is available to HMP. You can print or save your copy below.";
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
    render(); message.textContent = agreement.status === "Completed" ? "This form has already been completed. Your signed copy is below." : "";
  } catch (error) { message.textContent = error.message; }
}
load();
