import { informationTemplates } from "../information-form-schema.mjs";
import { agreementRequest, escape, fieldsHTML } from "../agreement-ui.mjs";
import { informationSummary, printInformation } from "../information-form-ui.mjs";
import { groupDocumentVersions } from "./document-versions.js";

const $ = selector => document.querySelector(selector);
const endpoint = "/api/hmp-agreement-forms";
let active, busy = false, dirty = false, link = "", listSignature = "";
const dialog = document.createElement("dialog");
dialog.className = "agreement-dialog"; dialog.id = "information-editor";
dialog.setAttribute("aria-labelledby", "information-editor-title");
document.body.append(dialog);
dialog.addEventListener("cancel", event => {if (busy || (dirty && !confirm("Discard unsaved changes?"))) event.preventDefault(); else dirty = false;});
window.addEventListener("beforeunload", event => {if (dirty) {event.preventDefault(); event.returnValue = "";}});

$("#client-google-forms").innerHTML = informationTemplates.map(t => `<article class="client-form-card"><h3>${escape(t.title)}</h3><p>Complete directly on the HMP website. Responses return to this page.</p><button class="agreement-button" type="button" data-information-template="${t.id}">Prepare client form</button><details><summary>Preview questions</summary><ul>${t.clientFields.map(f => `<li>${escape(f.label)}</li>`).join("")}</ul></details></article>`).join("");
$("#client-google-forms").addEventListener("click", event => {
  const button = event.target.closest("[data-information-template]");
  if (!button || busy) return;
  active = {snapshot:informationTemplates.find(t => t.id === button.dataset.informationTemplate), status:"Draft", clientName:"", clientEmail:"", adminAnswers:{}, clientAnswers:{}};
  dirty = false; link = ""; render(); dialog.showModal();
});

export async function loadInformationForms() {
  const message = $("#information-list-message");
  try {
    const data = await agreementRequest(endpoint);
    const rows = data.agreements.filter(row => informationTemplates.some(t => t.id === row.template_id));
    const signature = JSON.stringify(rows);
    if (signature !== listSignature) {
      $("#information-list").innerHTML = groupDocumentVersions(rows).map(versions => {
        const row = versions[0];
        const history = versions.length > 1 ? `<details class="document-version-history"><summary>Version history (${versions.length})</summary>${versions.slice(1, 5).map(old => `<button type="button" data-information-id="${escape(old.id)}">Version ${escape(old.revision_number)} · ${escape(old.status)}</button>`).join("")}${versions.length > 5 ? `<details><summary>${versions.length - 5} older archived versions</summary>${versions.slice(5).map(old => `<button type="button" data-information-id="${escape(old.id)}">Version ${escape(old.revision_number)} · ${escape(old.status)}</button>`).join("")}</details>` : ""}</details>` : "";
        return `<div class="agreement-version-entry"><button type="button" class="agreement-row" data-information-id="${escape(row.id)}"><span><strong>${escape(row.client_name)}</strong><small>${escape(row.client_email)} · Version ${escape(row.revision_number)}</small></span><span>${escape(informationTemplates.find(t => t.id === row.template_id).title)}</span><span>${escape(row.status === "Sent" ? "Awaiting client" : row.status)}${row.completed_at ? `<small>${escape(new Date(row.completed_at).toLocaleString())}</small>` : ""}</span></button>${history}</div>`;
      }).join("");
      listSignature = signature;
    }
    message.textContent = rows.length ? "Select a record to view responses, revise it, or share its private link." : "No client forms yet. Choose a form above to get started.";
    message.classList.add("neutral");
  } catch (error) {message.classList.remove("neutral"); message.textContent = error.message;}
}
$("#refresh-information-forms").addEventListener("click", loadInformationForms);
export async function openInformationDraft(id) {
  if (!id || busy) return;
  busy = true;
  try {
    const data = await agreementRequest(`${endpoint}?id=${encodeURIComponent(id)}`);
    active = data.agreement; link = data.link || ""; dirty = false; render(); dialog.showModal();
  } catch(error) {$("#information-list-message").textContent = error.message;}
  finally {busy = false;}
}
$("#information-list").addEventListener("click", event => {
  const button = event.target.closest("[data-information-id]");
  if (button) openInformationDraft(button.dataset.informationId);
});
function render() {
  const draft = active.status === "Draft";
  dialog.innerHTML = `<header><div><p>CLIENT INFORMATION · ${escape(active.status)}</p><h2 id="information-editor-title">${escape(active.snapshot.title)}</h2></div><button class="agreement-button secondary" id="information-close" type="button">Close</button></header>
    <form id="information-admin-form">${draft ? "<p>Prepare this form for a client. Create a private link to share in Messages, or email it directly. Responses are stored in HMP—not Google Forms.</p>" : ""}
    ${draft ? `<div class="agreement-grid"><label class="agreement-field">Client name<input name="clientName" required maxlength="200" value="${escape(active.clientName)}"></label><label class="agreement-field">Client email<input name="clientEmail" type="email" required maxlength="320" value="${escape(active.clientEmail)}"></label>${fieldsHTML(active.snapshot.adminFields, active.adminAnswers)}</div><label class="agreement-checkbox"><input name="requireSignature" type="checkbox" ${active.snapshot.signatureRequired ? "checked" : ""}><span>Require the client to sign this form (typed or drawn). Use this for in-person Money Table verification.</span></label>` : informationSummary(active, false)}
    ${draft ? `<details class="agreement-panel"><summary>Preview client questions</summary><ul>${active.snapshot.clientFields.map(f => `<li><strong>${escape(f.label)}</strong><p>${escape(f.help || "")}</p></li>`).join("")}</ul></details>` : ""}
    ${link ? `<label class="agreement-field">Private client link<input id="information-private-link" readonly value="${escape(link)}"></label><p>Share only with this client. The link expires after 90 days.</p>` : ""}
    <div class="agreement-actions">${draft ? `<button type="submit" class="agreement-button secondary">Save draft</button><button type="button" class="agreement-button" data-information-action="share">Create private link</button>` : `<button type="button" class="agreement-button" data-information-action="revise">Create revised draft</button>`}${["Draft","Sent"].includes(active.status) ? `<button type="button" class="agreement-button secondary" data-information-action="send">Email client form</button>` : ""}${link ? `<button type="button" class="agreement-button secondary" id="information-copy">Copy link</button><a class="agreement-button secondary" href="${escape(link)}" target="_blank" rel="noopener noreferrer">${active.status === "Sent" && active.snapshot.signatureRequired ? "Open for in-person signing" : "Open client form"}</a>` : ""}${active.status === "Completed" ? `<button type="button" class="agreement-button secondary" id="information-print">Print / PDF</button>` : ""}${active.id && ["Draft","Sent"].includes(active.status) ? `<button type="button" class="agreement-button secondary" data-information-action="void">Void form</button>` : ""}</div>${active.status === "Sent" && active.snapshot.signatureRequired ? `<p>Open the client-only form on the device they will use to sign. Keep the Admin portal private. After signing, review the completed form here, then add it to the matching client hub in Messages.</p>` : ""}${active.status === "Completed" ? `<p>To share this completed copy, add it to the matching client hub in Messages.</p>` : ""}<p id="information-status" class="agreement-status" role="status"></p></form>`;
  $("#information-close").onclick = () => {if (!busy && (!dirty || confirm("Discard unsaved changes?"))) {dirty = false; dialog.close();}};
  const form = $("#information-admin-form");
  form.oninput = () => {if (draft) dirty = true;};
  form.onsubmit = event => {event.preventDefault(); if (form.reportValidity()) perform("save");};
  dialog.querySelectorAll("[data-information-action]").forEach(button => button.onclick = () => {if (button.dataset.informationAction === "void" || form.reportValidity()) perform(button.dataset.informationAction);});
  $("#information-copy")?.addEventListener("click", async () => {
    try {await navigator.clipboard.writeText(link); $("#information-status").textContent = "Private link copied.";}
    catch {$("#information-private-link").select(); $("#information-status").textContent = "Link selected. Copy it manually.";}
  });
  $("#information-print")?.addEventListener("click", () => printInformation(active));
}
async function perform(action) {
  if (busy) return;
  if (action === "revise") {
    busy = true;
    $("#information-status").textContent = "Creating a linked draft…";
    try {
      const data = await agreementRequest(endpoint, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"revise", id:active.id})});
      active = data.agreement; link = ""; dirty = false;
      render();
      $("#information-status").textContent = `Version ${active.revisionNumber} is a private draft. The earlier form is unchanged.`;
      await loadInformationForms();
    } catch(error) {$("#information-status").textContent = error.message;}
    finally {busy = false;}
    return;
  }
  if (action === "send" && !confirm("Email this private form to the client shown above?")) return;
  if (action === "void" && !confirm("Void this form and disable its private link?")) return;
  const values = Object.fromEntries(new FormData($("#information-admin-form")));
  busy = true; dialog.querySelectorAll("button,input").forEach(el => el.disabled = true);
  $("#information-status").textContent = "Saving…";
  try {
    if (active.status === "Draft" && action !== "void") {
      const data = await agreementRequest(endpoint, {method:active.id ? "PATCH" : "POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:active.id, action:"save", updatedAt:active.updatedAt, templateId:active.snapshot.id, clientName:values.clientName, clientEmail:values.clientEmail, answers:{eventName:values.eventName},requireSignature:values.requireSignature === "on"})});
      active = data.agreement; dirty = false;
    }
    let warning = "";
    if (action !== "save") {
      const data = await agreementRequest(endpoint, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({id:active.id, action, updatedAt:active.updatedAt})});
      active = data.agreement; link = data.link || ""; warning = data.warning || ""; dirty = false;
    }
    render();
    $("#information-status").textContent = warning || ({save:"Draft saved.",share:"Private link ready. No email has been sent.",send:"Client form emailed.",void:"Form voided. Its link is disabled."}[action]);
    await loadInformationForms();
    window.dispatchEvent(new Event("hmp-drafts-changed"));
  } catch (error) {
    if (error.data?.agreement) {active = error.data.agreement; link = error.data.link || ""; dirty = false; render(); await loadInformationForms();}
    $("#information-status").textContent = error.message;
  } finally {busy = false; dialog.querySelectorAll("button,input").forEach(el => el.disabled = false);}
}
