import { agreementRequest, answersHTML, completionHTML, escape, fieldsHTML, printAgreement, termsHTML } from "./agreement-ui.mjs";
import { validateAnswers } from "./agreement-schema.mjs";
const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
const message = document.querySelector("#agreement-message"), content = document.querySelector("#agreement-content");
let agreement, consentText, dirty = false, busy = false;
const headers = {Authorization:`Bearer ${token}`, "Content-Type":"application/json"};
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
function render() {
  document.querySelector("#agreement-title").textContent = agreement.snapshot.title;
  const completed = agreement.status === "Completed";
  const prefill = {clientName:agreement.clientName, email:agreement.clientEmail};
  content.hidden = false;
  content.innerHTML = `<p>Prepared for ${escape(agreement.clientName)} · Form version ${escape(agreement.snapshot.version)}</p><p>Review the terms and HMP service details, then complete your information below. Your answers supply the corresponding blanks in this agreement; event-date placeholders refer to your event date.</p>
    <details class="agreement-panel" open><summary>Agreement terms — please read before signing</summary>${termsHTML(agreement.snapshot)}</details>
    <section class="agreement-panel"><h2>HMP service details</h2>${answersHTML(agreement.snapshot.adminFields, agreement.adminAnswers)}</section>
    ${completed ? completionHTML(agreement) : `<form id="client-agreement-form" class="agreement-panel"><h2>Your information</h2><p>* Required fields. Nothing is submitted until you sign.</p><div class="agreement-grid">${fieldsHTML(agreement.snapshot.clientFields, prefill)}</div><h2>Review & sign</h2><label class="agreement-field" for="signature-name">Type your full name<input id="signature-name" name="signatureName" autocomplete="name" required minlength="2" maxlength="200"></label><label class="agreement-checkbox"><input name="consent" type="checkbox" required><span>${escape(consentText)}</span></label><p>Your typed signature, answers, agreement version, submission time, and browser information will be recorded. Once submitted, the signed record cannot be edited.</p><button class="agreement-button" type="submit">Sign & submit form</button><p id="signature-status" class="agreement-status" role="status"></p></form>`}
    <div class="agreement-actions"><button type="button" class="agreement-button secondary" id="print-agreement">${completed ? "Print / save completed form" : "Print agreement terms"}</button></div>`;
  document.querySelector("#print-agreement").onclick = () => printAgreement(agreement);
  const form = document.querySelector("#client-agreement-form");
  form?.addEventListener("input", () => { dirty = true; });
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const status = document.querySelector("#signature-status");
    try {
      const values = Object.fromEntries(new FormData(form));
      const answers = validateAnswers(agreement.snapshot.clientFields, values);
      if (!confirm("Submit your electronic signature? Your answers will be locked after submission.")) return;
      busy = true; form.querySelectorAll("input,select,textarea,button").forEach(item => item.disabled = true);
      status.textContent = "Saving your signed form…";
      const data = await agreementRequest("/api/hmp-agreement", {method:"POST", headers, body:JSON.stringify({answers, signatureName:values.signatureName, consent:values.consent === "on"})});
      agreement = data.agreement; dirty = false; render();
      message.classList.add("success"); message.textContent = "Your signed form has been saved and is available to HMP. You can print or save your copy below.";
      message.scrollIntoView({block:"center"});
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; form.querySelectorAll("input,select,textarea,button").forEach(item => item.disabled = false); }
  });
}
async function load() {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Please open the private form link sent by HMP.");
    const data = await agreementRequest("/api/hmp-agreement", {headers});
    agreement = data.agreement; consentText = data.signingConsent;
    render(); message.textContent = agreement.status === "Completed" ? "This form has already been completed. Your signed copy is below." : "";
  } catch (error) { message.textContent = error.message; }
}
load();
