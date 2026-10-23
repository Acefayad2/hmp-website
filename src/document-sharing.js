import { agreementRequest, escape } from "../agreement-ui.mjs";
import { businessDate, expiryDateAfter, linkExpiration } from "../document-expiry.mjs";

// A separate modal keeps the user's unsaved document fields intact on cancellation.
export async function chooseDocumentSharing({copy = false, choosePortal = false, clientEmail = "", expiresAt = "", expirationDate = "", portalAccess = false} = {}) {
  let threads = [];
  if (choosePortal) {
    const data = await agreementRequest("/api/hmp-messages");
    threads = (data.threads || []).filter(thread => thread.active && (!clientEmail || thread.clientEmail?.toLowerCase() === clientEmail.trim().toLowerCase()));
    if (!threads.length) throw new Error("No active client portal matches this client. Create a link for the correct event in Messages first, then try again.");
  }
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "agreement-dialog";
    dialog.setAttribute("aria-label", portalAccess ? "Client portal expiration" : "Share client document");
    const value = expirationDate || (expiresAt && Date.parse(expiresAt) > Date.now() ? businessDate(new Date(expiresAt)) : expiryDateAfter(7));
    dialog.innerHTML = `<form><h2>${portalAccess ? "Client portal expiration" : copy ? "Copy private link" : "Send to Client Portal"}</h2><p>${portalAccess ? "Update the existing portal link without changing its URL or client PIN. No email is sent and documents are unchanged." : "This publishes a client copy. No email is sent. Clients use their existing portal PIN for portal documents."}</p>
      ${choosePortal ? `<label class="agreement-field">Client / event portal<select name="conversationId" required><option value="">Choose the correct event</option>${threads.map(thread => `<option value="${escape(thread.id)}">${escape(thread.clientName)} · ${escape(thread.service)} · ${escape(thread.celebrationDate || "Date not set")}</option>`).join("")}</select></label>` : ""}
      <label class="agreement-field">Link expiration date<input name="expirationDate" type="date" required min="${businessDate()}" value="${escape(value)}"></label>
      <p>Choose today or any future date, including more than 15 days after the event. This link closes at 11:59 PM Eastern time on your chosen date. Password protection, saved records and HMP staff access are unchanged. Documents inside a Client Portal also require that portal’s link to remain active.</p>
      <div class="agreement-actions"><button class="agreement-button" type="submit">${portalAccess ? "Save expiration" : copy ? "Create / copy link" : "Send to Client Portal"}</button><button class="agreement-button secondary" type="button">Cancel</button></div></form>`;
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
