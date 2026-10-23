import { agreementDraftFields, agreementTemplates, newAgreementSnapshot, moneyTablePaymentAmounts, validateAnswers, agreementTextIssues, validationError } from "../agreement-schema.mjs";
import terms from "../data/agreement-terms.json";
import { searchText } from "../page-search.js";
import { agreementRequest, answersHTML, completionHTML, escape, fieldsHTML, printAgreement, termsHTML, nativeFormIssues, showFormIssues } from "../agreement-ui.mjs";
import { agreementEditorHTML, mountAgreementEditors, readAgreementEditor } from "./agreement-text-editor.js";
import {mountDocumentVersions} from "./document-versions.js";
import {chooseDocumentSharing, copySharedLink} from "./document-sharing.js";

const $ = selector => document.querySelector(selector);
const endpoint = "/api/hmp-agreement-forms";
let active = null, busy = false, dirty = false, link = "";
const dialog = document.createElement("dialog");
dialog.className = "agreement-dialog"; dialog.id = "agreement-editor";
dialog.setAttribute("aria-labelledby", "agreement-editor-title");
document.body.append(dialog);
dialog.addEventListener("cancel", event => {
  if (busy || (dirty && !confirm("Discard unsaved changes to this form?"))) event.preventDefault();
});
window.addEventListener("beforeunload", event => { if (dirty) {event.preventDefault(); event.returnValue = "";} });

const templateList = $("#agreement-template-list");
templateList.innerHTML = agreementTemplates.filter(template => template.id !== "money-bank-verification").map(template => `<button class="agreement-template" type="button" data-template="${template.id}"><strong>${escape(template.title)}</strong><span>Prepare agreement →</span></button>`).join("");
templateList.addEventListener("click", event => {
  const button = event.target.closest("[data-template]");
  if (!button) return;
  const template = agreementTemplates.find(item => item.id === button.dataset.template);
  startTemplate(template);
});
function startTemplate(template) {
  active = {snapshot:newAgreementSnapshot(template,terms[template.id]), status:"Draft", adminAnswers:{}, clientName:"", clientEmail:""};
  link = ""; dirty = false; renderEditor(); dialog.showModal();
}
$("#create-bank-verification").addEventListener("click", () => startTemplate(agreementTemplates.find(item => item.id === "money-bank-verification")));

export async function loadAgreementForms() {
  const message = $("#agreement-list-message");
  try {
    const data = await agreementRequest(endpoint);
    const agreements = data.agreements.filter(row => agreementTemplates.some(t => t.id === row.template_id && t.id !== "money-bank-verification"));
    message.classList.add("neutral");
    message.textContent = agreements.length ? "" : "No agreement records yet. Choose a template above to get started.";
    $("#agreement-list").innerHTML = agreements.map(row => `<button class="agreement-row" type="button" data-agreement-id="${escape(row.id)}" data-search-text="${escape(searchText(row.client_email, row.created_at, row.completed_at, row.document_title))}"><span><strong>${escape(row.client_name)}</strong><small>${escape(row.document_title || agreementTemplates.find(t => t.id === row.template_id)?.title || "Client agreement")}</small></span><span>${escape(row.status)}${row.status === "Sent" && !row.email_delivered_at ? " · awaiting client" : ""}</span></button>`).join("");
  } catch (error) { message.classList.remove("neutral"); message.textContent = error.message; }
}
export async function loadBankVerificationForms() {
  const message = $("#bank-verification-message");
  try {
    const data = await agreementRequest(endpoint);
    const rows = data.agreements.filter(row => row.template_id === "money-bank-verification");
    $("#bank-verification-list").innerHTML = rows.map(row => `<button class="agreement-row" type="button" data-bank-verification-id="${escape(row.id)}"><span><strong>${escape(row.client_name)}</strong><small>${escape(row.document_title || "Money Bank Verification")}</small></span><span>${escape(row.status)}</span></button>`).join("");
    message.textContent = rows.length ? "Open a record to continue on-site or print a completed copy." : "No on-site verification records yet.";
    message.classList.add("neutral");
  } catch (error) {message.classList.remove("neutral"); message.textContent = error.message;}
}
$("#bank-verification-list").addEventListener("click", event => {
  const button = event.target.closest("[data-bank-verification-id]");
  if (button) openAgreementDraft(button.dataset.bankVerificationId);
});
export async function openAgreementDraft(id) {
  if (!id || busy) return;
  try {
    const data = await agreementRequest(`${endpoint}?id=${encodeURIComponent(id)}`);
    active = data.agreement; link = data.link || ""; dirty = false;
    renderEditor(); dialog.showModal(); return true;
  } catch(error) { $("#agreement-list-message").textContent = error.message; return false; }
}
$("#agreement-list").addEventListener("click", event => {
  const button = event.target.closest("[data-agreement-id]");
  if (button) openAgreementDraft(button.dataset.agreementId);
});
function renderEditor() {
  const draft = active.status === "Draft";
  dialog.innerHTML = `<header><div><p>CLIENT FORM · ${escape(active.status)}</p><h2 id="agreement-editor-title">${escape(active.snapshot.title)}</h2></div><button class="agreement-button secondary" type="button" id="agreement-close">Close</button></header>
    <form id="agreement-admin-form"><p>Prepare the service details, then send a private form for the client to complete and sign. Sent forms are locked; use Create revision to change terms while preserving the original.</p>
    ${draft ? `<div class="agreement-grid"><label class="agreement-field">Document title<input name="documentTitle" required maxlength="200" value="${escape(active.snapshot.title)}"></label><label class="agreement-field">Client name<input name="clientName" required maxlength="200" value="${escape(active.clientName)}"></label><label class="agreement-field">Client email<input name="clientEmail" type="email" required maxlength="320" value="${escape(active.clientEmail)}"></label></div><h3>HMP service details</h3><p>All starred fields must be completed before sending. You can save an incomplete draft.</p><div id="agreement-admin-fields" class="agreement-grid">${fieldsHTML(agreementDraftFields(active.snapshot, active.adminAnswers), active.adminAnswers, "admin-answer", false)}</div>` : `<p>Prepared for ${escape(active.clientName)} · ${escape(active.clientEmail)}</p>${answersHTML(active.snapshot.adminFields, active.adminAnswers)}`}
    ${draft ? `<details class="agreement-panel"><summary>Edit agreement wording</summary><p>Changes here affect this draft only. Select text to format it; the toolbar appears while editing. Keep field placeholders such as {{serviceHours}} intact. Sent and signed copies remain unchanged.</p>${active.snapshot.pages.map((page, i) => agreementEditorHTML(i)).join("")}</details>` : ""}
    <details class="agreement-panel"><summary>Review full agreement text</summary><p>Client answers and HMP service details supply the matching blanks in this agreement. The event date supplied by the client fills event-date placeholders.</p>${termsHTML(active.snapshot)}</details>
    ${active.status === "Completed" ? completionHTML(active) : ""}
    ${draft && !["client-only", "on-site-three-signatures"].includes(active.snapshot.signatureMode) ? `<label class="agreement-checkbox"><input id="agreement-hmp-consent" type="checkbox"><span>I authorize my typed name as my electronic signature for HMP on this agreement when I send it.</span></label>` : ""}
    <div class="agreement-actions">${draft ? `<button class="agreement-button secondary" type="submit">Save draft</button><button class="agreement-button secondary" type="button" id="agreement-share">${active.snapshot.signatureMode === "on-site-three-signatures" ? "Open on-site signing link" : "Create private link"}</button>${active.snapshot.signatureMode === "on-site-three-signatures" ? "" : '<button class="agreement-button" type="button" id="agreement-send">Send client form</button>'}` : ""}${active.status === "Sent" && active.snapshot.signatureMode !== "on-site-three-signatures" ? '<button class="agreement-button" type="button" id="agreement-send">Retry email delivery</button>' : ""}${["Sent", "Completed"].includes(active.status) ? '<button class="agreement-button secondary" type="button" id="agreement-copy">Copy private link</button>' : ""}${link && active.snapshot.signatureMode === "on-site-three-signatures" ? `<a class="agreement-button" href="${escape(link)}" target="_blank" rel="noopener noreferrer">Open signing page on this device</a>` : ""}<button class="agreement-button secondary" type="button" id="agreement-print-button">Print / PDF</button>${active.id && ["Draft", "Sent"].includes(active.status) ? '<button class="agreement-button secondary" type="button" id="agreement-void">Void form</button>' : ""}</div><p class="agreement-status" id="agreement-editor-status" role="status"></p></form>`;
  $("#agreement-close").onclick = () => { if (!busy && (!dirty || confirm("Discard unsaved changes to this form?"))) {dirty = false; dialog.close();} };
  const form = $("#agreement-admin-form");
  const approval = active.snapshot.clientFields.find(field => field.id === "customizationApproval");
  if (draft && approval) {
    const panel = document.createElement("section");
    panel.className = "agreement-panel";
    panel.innerHTML = `<h3>Client approval choices</h3><p>The client selects one choice before signing. Edit the wording below if needed.</p>${[["label", "Heading", approval.label], ["approve", "Approve choice", approval.options[0]], ["decline", "Decline choice", approval.options[1]]].map(([key,label,value]) => `<label class="agreement-field">${label}<input name="approval-${key}" maxlength="500" required value="${escape(value)}"></label>`).join("")}<fieldset disabled><legend>Client preview — choose one</legend>${fieldsHTML([approval], {}, "approval-preview")}</fieldset>`;
    $("#agreement-admin-fields").after(panel);
  }
  mountDocumentVersions(dialog,{kind:"form",id:active.id,status:active.status,beforeSwitch:()=>!busy&&(!dirty||confirm("Discard unsaved changes before switching versions?")),open:async(id)=>{dirty=false;await openAgreementDraft(id);await loadAgreementForms();}});
  if(active.legacyRevisionText&&draft){
    const warning=document.createElement("p");warning.className="agreement-status";
    warning.textContent="This older original contains fixed wording. Review and update every amount, date and payment term under Edit agreement wording; changing the service-detail fields alone does not replace fixed text.";
    form.prepend(warning);
  }
  form.noValidate = true;
  const expired = active.status === "Sent" && Date.parse(active.expiresAt) <= Date.now();
  form.insertAdjacentHTML("afterbegin", `<p>${active.expiresAt ? `Private link ${Date.parse(active.expiresAt) <= Date.now() ? "expired" : "expires"}: ${escape(new Date(active.expiresAt).toLocaleString())}.` : "Choose a calendar expiration date when sharing (any future date)."}</p>`);
  if (expired) {
    $("#agreement-send")?.remove();
    $("#agreement-copy")?.remove();
    const onSite = active.snapshot.signatureMode === "on-site-three-signatures";
    form.querySelector(".agreement-actions").insertAdjacentHTML("afterbegin", `<button class="agreement-button" type="button" id="agreement-renew">${onSite ? "Renew link (7 days)" : "Renew &amp; resend (7 days)"}</button>`);
    $("#agreement-renew").onclick = () => {
      if (!busy && confirm(`Create a new 7-day link? The expired link will remain disabled. ${onSite ? "No email will be sent." : `The new link will be emailed to ${active.clientEmail}.`} The form details will not change.`)) perform(onSite ? "renew" : "resend");
    };
  }
  const refreshPaymentAmounts = () => {
    const amounts = moneyTablePaymentAmounts(form.elements.serviceFee?.value, form.elements.retainerPercent?.value);
    for (const field of active.snapshot.adminFields.filter(field => field.calculated === "money-table-payment")) form.elements[field.id].value = amounts[field.id];
  };
  if (draft) refreshPaymentAmounts();
  form.oninput = event => {
    dirty = true;
    if (["serviceFee","retainerPercent"].includes(event.target.name)) refreshPaymentAmounts();
    if (approval && event.target.name?.startsWith("approval-")) {
      const preview = form.querySelector("fieldset[disabled]");
      const updated = {...approval, label:form.elements["approval-label"].value, options:[form.elements["approval-approve"].value,form.elements["approval-decline"].value]};
      preview.innerHTML = `<legend>Client preview — choose one</legend>${fieldsHTML([updated], {}, "approval-preview")}`;
    }
  };
  if (draft) mountAgreementEditors(form,active.snapshot,() => {
    dirty = true;
    const pages = [...form.querySelectorAll("[data-agreement-editor]")].map(readAgreementEditor);
    form.querySelectorAll(".agreement-terms-page").forEach((section,i) => {
      section.outerHTML = termsHTML({pages:[pages[i].text],pageFormatting:[pages[i].formatting]}).replace("1 / 1", `${i+1} / ${pages.length}`);
    });
  });
  form.onsubmit = event => {event.preventDefault(); if (!busy) perform("save");};
  $("#agreement-send")?.addEventListener("click", () => { if (!busy && form.reportValidity()) perform("send"); });
  $("#agreement-share")?.addEventListener("click", () => { if (!busy && form.reportValidity()) perform("share"); });
  $("#agreement-void")?.addEventListener("click", () => { if (!busy && confirm("Void this form? Its private link will stop working. Existing signed forms are never deleted.")) perform("void"); });
  $("#agreement-print-button").onclick = () => {
    if (!draft) return printAgreement(active);
    try {
      const values = formValues();
      const clientFields = active.snapshot.clientFields.map(field => field.id === "customizationApproval" && values.approvalWording ? {...field, label:values.approvalWording.label, options:[values.approvalWording.approve,values.approvalWording.decline]} : field);
      printAgreement({...active, ...values, snapshot:{...active.snapshot, title:values.title, pages:values.pages, pageFormatting:values.pageFormatting, clientFields}});
    } catch(error) { $("#agreement-editor-status").textContent = error.message; }
  };
  $("#agreement-copy")?.addEventListener("click", async () => {
    try {await navigator.clipboard.writeText(link); $("#agreement-editor-status").textContent = "Private link copied. Share it only with this client.";}
    catch {$("#agreement-editor-status").textContent = "Copying was blocked by your browser. Please use the emailed link.";}
  });
  for (const id of ["agreement-send","agreement-share","agreement-copy","agreement-renew"]) $(`#${id}`)?.remove();
  if (active.status !== "Void") {
    const actions = form.querySelector(".agreement-actions");
    for (const copy of [false,true]) {
      if (!copy && active.snapshot.signatureMode === "on-site-three-signatures") continue;
      const button = document.createElement("button"); button.type="button"; button.className="agreement-button secondary";
      button.textContent=copy ? "Copy Private Link" : "Send to Client Portal";
      button.onclick=()=>shareAgreement(copy); actions.prepend(button);
    }
  }
}
async function shareAgreement(copy) {
  if (busy) return;
  try {
    const email = active.status === "Draft" ? $("#agreement-admin-form").elements.clientEmail.value : active.clientEmail;
    const sharing = await chooseDocumentSharing({copy,choosePortal:!copy,clientEmail:email,expiresAt:active.expiresAt});
    if (!sharing) return;
    await perform(active.status === "Draft" ? "share" : "access",sharing);
    if (!link) return;
    if (!copy) await agreementRequest("/api/hmp-messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"share-form",formId:active.id,conversationId:sharing.conversationId})});
    $("#agreement-editor-status").textContent="Form shared in the selected client portal. No email was sent.";
    if (copy) await copySharedLink(link,$("#agreement-editor-status"));
  } catch(error) { $("#agreement-editor-status").textContent=error.message; }
}
function formValues() {
  const values = Object.fromEntries(new FormData($("#agreement-admin-form")));
  const pages = [...document.querySelectorAll("#agreement-admin-form [data-agreement-editor]")].map(readAgreementEditor);
  pages.forEach((page,i) => {if (!page.text.trim() || page.text.length > 15000) throw new Error(`Agreement page ${i+1} must contain text and be no longer than 15,000 characters.`);});
  return {title:values.documentTitle, pages:pages.map(page => page.text), pageFormatting:pages.map(page => page.formatting), clientName:values.clientName, clientEmail:values.clientEmail, ...(values["approval-label"] !== undefined ? {approvalWording:{label:values["approval-label"],approve:values["approval-approve"],decline:values["approval-decline"]}} : {}), adminAnswers:validateAnswers(active.snapshot.adminFields, values, false)};
}
async function perform(action, sharing = {}) {
  if (busy) return;
  const status = $("#agreement-editor-status");
  let sendConsent = false;
  try {
    showFormIssues($("#agreement-admin-form"), []);
    status.classList.remove("success");
    let values;
    if (active.status === "Draft" && action !== "void") {
      values = formValues();
      const issuing = action === "send" || action === "share";
      const issues = nativeFormIssues($("#agreement-admin-form"));
      try { values.adminAnswers = validateAnswers(active.snapshot.adminFields, values.adminAnswers, issuing); }
      catch (error) { issues.push(...error.issues); }
      if (issuing) {
        issues.push(...agreementTextIssues({...active.snapshot, pages:values.pages}));
        sendConsent = ["client-only", "on-site-three-signatures"].includes(active.snapshot.signatureMode) || $("#agreement-hmp-consent").checked;
        if (!sendConsent) issues.push({id:"agreement-hmp-consent", message:"HMP electronic signature: check the authorization box before sharing."});
      }
      if (issues.length) throw validationError(issues);
      if (action === "send" || action === "share") {
        if (!confirm(`${action === "share" ? "Create a private link for" : "Send this form to"} ${values.clientEmail}? Service details will be locked.${action === "share" ? " No email will be sent." : ""}`)) return;
      }
    }
    busy = true;
    dialog.querySelectorAll("button,input,textarea,select").forEach(item => item.disabled = true);
    dialog.querySelectorAll("[data-agreement-editor]").forEach(item => item.setAttribute("contenteditable","false"));
    status.textContent = action === "send" ? "Preparing and sending client form…" : "Saving…";
    if (values) {
      const data = await agreementRequest(endpoint, {method:active.id ? "PATCH" : "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:active.id, action:"save", updatedAt:active.updatedAt, templateId:active.snapshot.id, title:values.title, pages:values.pages, pageFormatting:values.pageFormatting, clientName:values.clientName, clientEmail:values.clientEmail, answers:values.adminAnswers, approvalWording:values.approvalWording})});
      active = data.agreement; dirty = false;
    }
    let warning = "";
    if (["send", "share", "void", "renew", "resend", "access"].includes(action)) {
      const data = await agreementRequest(endpoint, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:active.id, action, updatedAt:active.updatedAt, hmpConsent:sendConsent, ...sharing})});
      active = data.agreement; link = data.link || ""; warning = data.warning || ""; dirty = false;
    }
    renderEditor();
    $("#agreement-editor-status").textContent = warning || (action === "send" ? "Client form sent. The client can complete and sign it using the private link." : action === "share" ? "Private link ready to copy and text to this client. No email was sent." : action === "void" ? "Form voided. The private link is disabled." : "Draft saved.");
    $("#agreement-editor-status").classList.add("success");
    if (action === "resend") $("#agreement-editor-status").textContent = warning || "New 7-day link emailed. The expired link remains disabled.";
    if (action === "renew") $("#agreement-editor-status").textContent = "New 7-day link ready. No email was sent; open the signing page or copy the new link.";
    if (active.snapshot.id === "money-bank-verification") await loadBankVerificationForms();
    else await loadAgreementForms();
    window.dispatchEvent(new Event("hmp-drafts-changed"));
  } catch(error) {
    if (error.data?.agreement) { active = error.data.agreement; link = error.data.link || ""; dirty = false; renderEditor(); await loadAgreementForms(); }
    const issues = error.issues || error.data?.issues;
    $("#agreement-editor-status").textContent = issues ? "Review the highlighted items above. Your entries are still here." : error.message;
    showFormIssues($("#agreement-admin-form"), issues || [{message:error.message}]);
    link = "";
  } finally { busy = false; dialog.querySelectorAll("button,input,textarea,select").forEach(item => item.disabled = false); dialog.querySelectorAll("[data-agreement-editor]").forEach(item => item.setAttribute("contenteditable","true")); }
}
