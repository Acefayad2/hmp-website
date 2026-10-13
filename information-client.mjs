import { agreementRequest, escape, fieldsHTML } from "./agreement-ui.mjs";
import { validateAnswers } from "./agreement-schema.mjs";
import { informationSummary, printInformation } from "./information-form-ui.mjs";
import { signatureFieldsHTML, wireSignatureCapture } from "./signature-capture.mjs";

export function renderInformationForm(record, headers) {
  const content = document.querySelector("#agreement-content"), message = document.querySelector("#agreement-message");
  let busy = false, dirty = false;
  window.addEventListener("beforeunload", event => {if (dirty) {event.preventDefault(); event.returnValue = "";}});
  document.title = `${record.snapshot.title} | HMP`;
  document.querySelector("#agreement-title").textContent = record.snapshot.title;
  content.hidden = false;
  function render() {
    const completed = record.status === "Completed";
    content.innerHTML = `<p>Prepared for ${escape(record.clientName)}${record.adminAnswers.eventName ? ` · ${escape(record.adminAnswers.eventName)}` : ""}</p><p>${escape(record.snapshot.description)}</p>
      ${completed ? `<section class="agreement-panel">${informationSummary(record, false)}</section><button type="button" class="agreement-button secondary" id="information-print">Print / save my responses</button>` : `<form id="information-client-form" class="agreement-panel"><p>* Required. Answers are saved when you select ${record.snapshot.signatureRequired ? "Sign & submit form" : "Submit information"}. Keep this page open until you see confirmation.</p><div class="agreement-grid">${fieldsHTML(record.snapshot.clientFields, {email:record.clientEmail,...record.clientAnswers})}</div><p>Only share public payment handles or QR codes—never bank account numbers, passwords, or login codes.</p>${record.snapshot.signatureRequired ? signatureFieldsHTML(record.snapshot.signingConsent) : ""}<button class="agreement-button" type="submit">${record.snapshot.signatureRequired ? "Sign & submit form" : "Submit information"}</button><p id="information-save-status" class="agreement-status" role="status"></p></form>`}`;
    message.textContent = completed ? `${record.signature ? "Your signed form has been saved and is" : "Your responses have been saved and are"} available to HMP. Contact HMP if anything needs correcting.` : "";
    message.classList.toggle("success", completed);
    document.querySelector("#information-print")?.addEventListener("click", () => printInformation(record));
    const form = document.querySelector("#information-client-form");
    const captureSignature = form && record.snapshot.signatureRequired ? wireSignatureCapture(form) : null;
    form?.addEventListener("input", () => {dirty = true;});
    form?.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      const status = document.querySelector("#information-save-status");
      try {
        const answers = validateAnswers(record.snapshot.clientFields, Object.fromEntries(new FormData(form)));
        const signature = captureSignature ? captureSignature() : {};
        if (captureSignature && !confirm("Submit your electronic signature? This completed form cannot be edited.")) return;
        busy = true; form.querySelectorAll("input,textarea,select,button").forEach(el => el.disabled = true);
        status.textContent = "Saving your information…";
        const data = await agreementRequest("/api/hmp-agreement", {method:"POST", headers, body:JSON.stringify({answers,...signature,consent:form.elements.consent?.checked === true})});
        record = data.agreement; dirty = false; render();
        message.scrollIntoView({block:"center", behavior:"smooth"});
      } catch (error) {status.textContent = `${error.message} Your entries are still here; please try again.`;}
      finally {busy = false; form.querySelectorAll("input,textarea,select,button").forEach(el => el.disabled = false);}
    });
  }
  render();
}
