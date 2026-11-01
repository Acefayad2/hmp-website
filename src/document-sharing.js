import { agreementRequest, escape } from "../agreement-ui.mjs";
import { businessDate, expiryDateAfter, linkExpiration } from "../document-expiry.mjs";

export function createInteractionGuard() {
  let active = false;
  return {
    begin() { if (active) return false; active = true; return true; },
    end() { active = false; },
  };
}

export function beginDeferredClipboardCopy({
  clipboard = globalThis.navigator?.clipboard,
  ClipboardItemClass = globalThis.ClipboardItem,
  BlobClass = globalThis.Blob,
} = {}) {
  if (!clipboard?.write || !ClipboardItemClass || !BlobClass) return null;
  let resolveText, rejectText;
  const text = new Promise((resolve, reject) => { resolveText = resolve; rejectText = reject; });
  let write;
  try {
    write = Promise.resolve(clipboard.write([
      new ClipboardItemClass({"text/plain": text.then(value => new BlobClass([value], {type:"text/plain"}))}),
    ]));
    write.catch(() => {});
  } catch {
    return null;
  }
  let settled = false;
  return {
    async complete(value) {
      if (settled) return false;
      settled = true;
      resolveText(String(value));
      await write;
      return true;
    },
    async cancel() {
      if (settled) return false;
      settled = true;
      rejectText(new Error("Clipboard copy cancelled"));
      await write.catch(() => {});
      return true;
    },
  };
}

// A separate modal keeps the user's unsaved document fields intact on cancellation.
export async function chooseDocumentSharing({copy = false, choosePortal = false, clientEmail = "", expiresAt = "", expirationDate = "", portalAccess = false, expirationMode = "custom", deferClipboardCopy = false} = {}) {
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
      ${portalAccess ? `<label class="agreement-field">Expiration rule<select name="expirationMode"><option value="event" ${expirationMode === "event" ? "selected" : ""}>Automatic — 7 days after the event</option><option value="custom" ${expirationMode !== "event" ? "selected" : ""}>Custom date chosen by Admin</option></select></label><p>Automatic access ends 7 days after the last event date, at 11:59 PM Eastern time. If no event date is saved, it ends 7 days after the hub was created. Selecting automatic for a past event may expire access immediately. Records are not deleted.</p>` : ""}
      <label class="agreement-field">Link expiration date<input name="expirationDate" type="date" required min="${businessDate()}" value="${escape(value)}"></label>
      <p>Choose today or any future date, including more than 15 days after the event. This link closes at 11:59 PM Eastern time on your chosen date. Password protection, saved records and HMP staff access are unchanged. Documents inside a Client Portal also require that portal’s link to remain active.</p>
      <div class="agreement-actions"><button class="agreement-button" type="submit">${portalAccess ? "Save expiration" : copy ? "Create / copy link" : "Send to Client Portal"}</button><button class="agreement-button secondary" type="button">Cancel</button></div></form>`;
    const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
    dialog.querySelector('[type=button]').onclick = () => finish(null);
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    dialog.querySelector("form").onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      try {
        if (values.expirationMode !== "event") linkExpiration(values.expirationDate);
        finish(deferClipboardCopy && copy ? {sharing:values, preparedCopy:beginDeferredClipboardCopy()} : values);
      }
      catch (error) { dialog.querySelector('[name=expirationDate]').setCustomValidity(error.message); event.currentTarget.reportValidity(); }
    };
    dialog.querySelector('[name=expirationDate]').oninput = event => event.target.setCustomValidity("");
    if (portalAccess) {
      const mode = dialog.querySelector('[name=expirationMode]');
      const date = dialog.querySelector('[name=expirationDate]');
      const sync = () => { date.disabled = mode.value === "event"; date.closest("label").hidden = date.disabled; date.setCustomValidity(""); };
      mode.onchange = sync;
      sync();
    }
    document.body.append(dialog); dialog.showModal();
  });
}

export async function copySharedLink(url, status, {preparedCopy = null, clipboard = globalThis.navigator?.clipboard, documentObject = globalThis.document} = {}) {
  try {
    if (preparedCopy) await preparedCopy.complete(url);
    else await clipboard.writeText(url);
    status.textContent = "Private link copied. Share only with this client. No email was sent.";
  }
  catch {
    status.textContent = "The document is shared. Tap Copy link to try again, or select and copy the link below: ";
    const input = documentObject.createElement("input"); input.readOnly = true; input.value = url;
    input.setAttribute("aria-label", "Private client link");
    const retry = documentObject.createElement("button");
    retry.type = "button"; retry.className = "agreement-button secondary"; retry.textContent = "Copy link";
    retry.onclick = async () => {
      try {
        await clipboard.writeText(url);
        status.textContent = "Private link copied. Share only with this client. No email was sent.";
      } catch {
        retry.textContent = "Copy blocked — select link below";
        input.focus(); input.select();
      }
    };
    status.append(retry, input); input.select();
  }
}
