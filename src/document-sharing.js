import { agreementRequest, escape } from "../agreement-ui.mjs";
import { businessDate, expiryDateAfter, linkExpiration } from "../document-expiry.mjs";

// A separate modal keeps the user's unsaved document fields intact on cancellation.
export async function chooseDocumentSharing({copy = false, choosePortal = false, clientEmail = "", expiresAt = ""} = {}) {
  let threads = [];
  if (choosePortal) {
    const data = await agreementRequest("/api/hmp-messages");
    threads = (data.threads || []).filter(thread => thread.active && (!clientEmail || thread.clientEmail?.toLowerCase() === clientEmail.trim().toLowerCase()));
    if (!threads.length) throw new Error("No active client portal matches this client. Create a link for the correct event in Messages first, then try again.");
  }
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "agreement-dialog";
    dialog.setAttribute("aria-label", "Share client document");
    const value = expiresAt && Date.parse(expiresAt) > Date.now() ? businessDate(new Date(expiresAt)) : expiryDateAfter(7);
    dialog.innerHTML = `<form><h2>${copy ? "Copy private link" : "Send to Client Portal"}</h2><p>This publishes a client copy. No email is sent. Clients use their existing portal PIN for portal documents.</p>
      ${choosePortal ? `<label class="agreement-field">Client / event portal<select name="conversationId" required><option value="">Choose the correct event</option>${threads.map(thread => `<option value="${escape(thread.id)}">${escape(thread.clientName)} · ${escape(thread.service)} · ${escape(thread.celebrationDate || "Date not set")}</option>`).join("")}</select></label>` : ""}
      <label class="agreement-field">Link expiration date<input name="expirationDate" type="date" required min="${businessDate()}" max="${expiryDateAfter(30)}" value="${escape(value)}"></label>
      <p>Access ends at 11:59 PM Eastern time on this date. The saved document is kept. This does not change payment deadlines or other portal links.</p>
      <div class="agreement-actions"><button class="agreement-button" type="submit">${copy ? "Create / copy link" : "Send to Client Portal"}</button><button class="agreement-button secondary" type="button">Cancel</button></div></form>`;
    const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
    dialog.querySelector('[type=button]').onclick = () => finish(null);
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    dialog.querySelector("form").onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try { linkExpiration(values.expirationDate); finish(values); }
      catch (error) { dialog.querySelector('[name=expirationDate]').setCustomValidity(error.message); event.currentTarget.reportValidity(); }
    };
    dialog.querySelector('[name=expirationDate]').oninput = event => event.target.setCustomValidity("");
    document.body.append(dialog); dialog.showModal();
  });
}

export async function copySharedLink(url, status) {
  try { await navigator.clipboard.writeText(url); status.textContent = "Private link copied. Share only with this client. No email was sent."; }
  catch {
    status.textContent = "The document is shared. Copy this private link manually: ";
    const input = document.createElement("input"); input.readOnly = true; input.value = url;
    input.setAttribute("aria-label", "Private client link"); status.append(input); input.select();
  }
}
