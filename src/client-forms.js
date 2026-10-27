import { activeInformationTemplates, informationTemplates } from "../information-form-schema.mjs";
import { agreementRequest, escape, fieldsHTML, checkFormInputs, showFormIssues } from "../agreement-ui.mjs";
import { informationSummary, printInformation, previewInformation } from "../information-form-ui.mjs";
import { loadBankVerificationForms } from "./agreement-admin.js";
import {mountDocumentVersions} from "./document-versions.js";
import {chooseDocumentSharing, copySharedLink, createInteractionGuard} from "./document-sharing.js";

const $ = selector => document.querySelector(selector);
const endpoint = "/api/hmp-agreement-forms";
let active, busy = false, dirty = false, link = "", listSignature = "";
const sharingInteraction = createInteractionGuard();
const dialog = document.createElement("dialog");
dialog.className = "agreement-dialog"; dialog.id = "information-editor";
dialog.setAttribute("aria-labelledby", "information-editor-title");
document.body.append(dialog);
dialog.addEventListener("cancel", event => {if (busy || (dirty && !confirm("Discard unsaved changes?"))) event.preventDefault(); else dirty = false;});
window.addEventListener("beforeunload", event => {if (dirty) {event.preventDefault(); event.returnValue = "";}});

$("#client-google-forms").innerHTML = activeInformationTemplates.map(t => `<details class="client-form-card"><summary><strong>${escape(t.title)}</strong> · ${escape(t.subtitle)}</summary><div class="client-form-template-content"><p>Complete directly on the HMP website. Responses return to this page.</p><div class="agreement-actions"><button class="agreement-button" type="button" data-information-template="${t.id}">Prepare client form</button><button class="agreement-button secondary" type="button" data-information-preview="${t.id}">Preview form</button></div></div></details>`).join("");
$("#client-google-forms").addEventListener("click", event => {
  const preview = event.target.closest("[data-information-preview]");
  if (preview) {previewInformation({snapshot:activeInformationTemplates.find(t => t.id === preview.dataset.informationPreview), status:"Draft", adminAnswers:{}}); return;}
  const button = event.target.closest("[data-information-template]");
  if (!button || busy) return;
  active = {snapshot:activeInformationTemplates.find(t => t.id === button.dataset.informationTemplate), status:"Draft", clientName:"", clientEmail:"", adminAnswers:{}, clientAnswers:{}};
  dirty = false; link = ""; render(); dialog.showModal();
});

export async function loadInformationForms() {
  const message = $("#information-list-message");
  try {
    const data = await agreementRequest(endpoint);
    const rows = data.agreements.filter(row => informationTemplates.some(t => t.id === row.template_id));
    const signature = JSON.stringify(rows);
    if (signature !== listSignature) {
      $("#information-list").innerHTML = rows.map(row => {
        const template = informationTemplates.find(t => t.id === row.template_id);
        return `<button type="button" class="agreement-row" data-information-id="${escape(row.id)}"><span><strong>${escape(row.client_name)}</strong><small>${escape(row.client_email)}</small></span><span>${escape(row.document_title || template.title)}${template.subtitle ? `<small>${escape(template.subtitle)}</small>` : ""}</span><span>${escape(row.status === "Sent" ? "Awaiting client" : row.status)}${row.completed_at ? `<small>${escape(new Date(row.completed_at).toLocaleString())}</small>` : ""}</span></button>`;
      }).join("");
      listSignature = signature;
    }
    message.textContent = rows.length ? "Select a record to view responses or share its private link." : "No client forms yet. Choose a form above to get started.";
    message.classList.add("neutral");
    await loadBankVerificationForms();
  } catch (error) {message.classList.remove("neutral"); message.textContent = error.message;}
}
$("#refresh-information-forms").addEventListener("click", loadInformationForms);
export async function openInformationDraft(id) {
  if (!id || busy) return;
  busy = true;
  try {
    const data = await agreementRequest(`${endpoint}?id=${encodeURIComponent(id)}`);
    active = data.agreement; link = data.link || ""; dirty = false; render(); dialog.showModal(); return true;
  } catch(error) {$("#information-list-message").textContent = error.message; return false;}
  finally {busy = false;}
}
$("#information-list").addEventListener("click", event => {
  const button = event.target.closest("[data-information-id]");
  if (button) openInformationDraft(button.dataset.informationId);
});
function render() {
  const draft = active.status === "Draft";
  dialog.innerHTML = `<header><div><p>CLIENT INFORMATION · ${escape(active.status)}</p><h2 id="information-editor-title">${escape(active.snapshot.title)}</h2>${active.snapshot.subtitle ? `<p>${escape(active.snapshot.subtitle)}</p>` : ""}</div><button class="agreement-button secondary" id="information-close" type="button">Close</button></header>
    <form id="information-admin-form">${draft ? "<p>Prepare this form for a client. Choose Send to Client Portal or Copy Private Link. Email is available through Messages. Responses are stored in HMP—not Google Forms.</p>" : ""}
    ${draft ? `<div class="agreement-grid"><label class="agreement-field">Document title<input name="documentTitle" required maxlength="200" value="${escape(active.snapshot.title)}"></label><label class="agreement-field">Client name<input name="clientName" required maxlength="200" value="${escape(active.clientName)}"></label><label class="agreement-field">Client email<input name="clientEmail" type="email" required maxlength="320" value="${escape(active.clientEmail)}"></label>${fieldsHTML(active.snapshot.adminFields, active.adminAnswers)}</div><label class="agreement-field">Form introduction (optional)<textarea name="documentDescription" maxlength="5000" rows="5">${escape(active.snapshot.description)}</textarea><small>Leave blank, or add a message for this client. Your wording appears above the client questions.</small></label>` : informationSummary(active, false)}
    ${draft ? `<details class="agreement-panel"><summary>Preview client questions</summary><ul>${active.snapshot.clientFields.map(f => `<li><strong>${escape(f.label)}</strong><p>${escape(f.help || "")}</p></li>`).join("")}</ul></details>` : ""}
    ${link ? `<label class="agreement-field">Private client link<input id="information-private-link" readonly value="${escape(link)}"></label><p>Share only with this client. Link ${Date.parse(active.expiresAt) <= Date.now() ? "expired" : "expires"}: ${escape(new Date(active.expiresAt).toLocaleString())}.</p>` : "<p>Choose a calendar expiration date when sharing (any future date).</p>"}
    <div class="agreement-actions">${draft ? `<button type="submit" class="agreement-button secondary">Save draft</button><button type="button" class="agreement-button" data-information-action="share">Create private link</button>` : ""}${["Draft","Sent"].includes(active.status) ? `<button type="button" class="agreement-button secondary" data-information-action="send">Email client form</button>` : ""}${link ? `<a class="agreement-button secondary" href="${escape(link)}" target="_blank" rel="noopener noreferrer">Open client form</a>` : ""}${active.status === "Completed" ? `<button type="button" class="agreement-button secondary" id="information-print">Print / PDF</button>` : ""}${active.id && ["Draft","Sent"].includes(active.status) ? `<button type="button" class="agreement-button secondary" data-information-action="void">Void form</button>` : ""}</div><p id="information-status" class="agreement-status" role="status"></p></form>`;
  $("#information-close").onclick = () => {if (!busy && (!dirty || confirm("Discard unsaved changes?"))) {dirty = false; dialog.close();}};
  const form = $("#information-admin-form");
  const previewButton = document.createElement("button");
  previewButton.type = "button"; previewButton.className = "agreement-button secondary"; previewButton.textContent = "Preview form";
  previewButton.onclick = () => {
    if (!draft) return previewInformation(active);
    const values = Object.fromEntries(new FormData(form));
    previewInformation({...active, clientName:values.clientName, clientEmail:values.clientEmail,
      snapshot:{...active.snapshot,title:values.documentTitle,description:values.documentDescription},
      adminAnswers:Object.fromEntries(active.snapshot.adminFields.map(field => [field.id,values[field.id] || ""]))});
  };
  form.querySelector(".agreement-actions").prepend(previewButton);
  mountDocumentVersions(dialog,{kind:"form",id:active.id,status:active.status,beforeSwitch:()=>!busy&&(!dirty||confirm("Discard unsaved changes before switching versions?")),open:async(id)=>{dirty=false;await openInformationDraft(id);await loadInformationForms();}});
  form.noValidate = true;
  if (active.status === "Sent" && Date.parse(active.expiresAt) <= Date.now()) {
    const send = form.querySelector('[data-information-action="send"]');
    send.dataset.informationAction = "resend";
    send.textContent = "Renew & resend (7 days)";
  }
  form.oninput = () => {if (draft) dirty = true;};
  form.onsubmit = event => {event.preventDefault(); if (!busy && checkFormInputs(form)) perform("save");};
  dialog.querySelectorAll("[data-information-action]").forEach(button => button.onclick = () => {if (!busy && (button.dataset.informationAction === "void" || checkFormInputs(form))) perform(button.dataset.informationAction);});
  $("#information-print")?.addEventListener("click", () => printInformation(active));
  // Sharing is portal-first; email remains available through Messages only.
  dialog.querySelector('[data-information-action="send"]')?.remove();
  dialog.querySelector('[data-information-action="resend"]')?.remove();
  dialog.querySelector('[data-information-action="share"]')?.remove();
  if (active.status !== "Void") {
    const actions = form.querySelector(".agreement-actions");
    for (const copy of [false,true]) {
      const button = document.createElement("button"); button.type="button"; button.className="agreement-button secondary";
      button.textContent=copy ? "Copy Private Link" : "Send to Client Portal";
      button.onclick=()=>copy && link && Date.parse(active.expiresAt) > Date.now()
        ? copySharedLink(link,$("#information-status"))
        : shareInformation(copy);
      actions.prepend(button);
    }
  }
}
async function shareInformation(copy) {
  if (busy || (active.status === "Draft" && !checkFormInputs($("#information-admin-form"))) || !sharingInteraction.begin()) return;
  let preparedCopy = null;
  try {
    const email = active.status === "Draft" ? $("#information-admin-form").elements.clientEmail.value : active.clientEmail;
    const choice = await chooseDocumentSharing({copy,choosePortal:!copy,clientEmail:email,expiresAt:active.expiresAt,deferClipboardCopy:copy});
    if (!choice) return;
    const selected = copy ? choice : {sharing:choice, preparedCopy:null};
    const sharing = selected.sharing; preparedCopy = selected.preparedCopy;
    await perform(active.status === "Draft" ? "share" : "access",sharing);
    if (!link) { await preparedCopy?.cancel(); return; }
    if (!copy) await agreementRequest("/api/hmp-messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"share-form",formId:active.id,conversationId:sharing.conversationId})});
    $("#information-status").textContent = "Form shared in the selected client portal. No email was sent.";
    if (copy) await copySharedLink(link,$("#information-status"),{preparedCopy});
  } catch(error) { await preparedCopy?.cancel(); $("#information-status").textContent=error.message; }
  finally { sharingInteraction.end(); }
}
async function perform(action, sharing = {}) {
  if (busy) return;
  if (action === "send" && !confirm("Email this private form to the client shown above?")) return;
  if (action === "resend" && !confirm(`Create and email a new 7-day link to ${active.clientEmail}? The expired link stays disabled and the form details will not change.`)) return;
  if (action === "void" && !confirm("Void this form and disable its private link?")) return;
  const values = Object.fromEntries(new FormData($("#information-admin-form")));
  busy = true; dialog.querySelectorAll("button,input,textarea,select").forEach(el => el.disabled = true);
  $("#information-status").textContent = "Saving…";
  try {
    if (active.status === "Draft" && action !== "void") {
      const answers = Object.fromEntries(active.snapshot.adminFields.map(field => [field.id, values[field.id] || ""]));
      const data = await agreementRequest(endpoint, {method:active.id ? "PATCH" : "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:active.id, action:"save", updatedAt:active.updatedAt, templateId:active.snapshot.id, clientName:values.clientName, clientEmail:values.clientEmail, title:values.documentTitle, description:values.documentDescription, answers})});
      active = data.agreement; dirty = false;
    }
    let warning = "";
    if (action !== "save") {
      const data = await agreementRequest(endpoint, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:active.id, action, updatedAt:active.updatedAt, ...sharing})});
      active = data.agreement; link = data.link || ""; warning = data.warning || ""; dirty = false;
    }
    render();
    $("#information-status").textContent = warning || ({save:"Draft saved.",share:"Private link ready. No email has been sent.",send:"Client form emailed.",resend:"New 7-day link emailed. The expired link remains disabled.",void:"Form voided. Its link is disabled."}[action]);
    await loadInformationForms();
    window.dispatchEvent(new Event("hmp-drafts-changed"));
  } catch (error) {
    if (error.data?.agreement) {active = error.data.agreement; link = error.data.link || ""; dirty = false; render(); await loadInformationForms();}
    $("#information-status").textContent = error.message;
    showFormIssues($("#information-admin-form"), error.issues || error.data?.issues || [{message:error.message}]);
    link = "";
  } finally {busy = false; dialog.querySelectorAll("button,input,textarea,select").forEach(el => el.disabled = false);}
}
