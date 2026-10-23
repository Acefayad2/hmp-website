import { parseProposal } from "./proposal-ui.js";

export const clientActivityItems = (thread, formsById = new Map(), seatingItems = []) => {
  const items = [];
  for (const message of thread?.messages || []) {
    const document = message.sender === "admin" ? message.document : null;
    const kind = document?.kind;
    if (["invoice", "contract", "receipt", "form", "seating"].includes(kind)) {
      const title = kind === "form" ? document.title || "Client form"
        : kind === "seating" ? "Guest Seating portal"
        : `${kind === "invoice" ? "Invoice" : kind === "receipt" ? "Receipt" : "Contract"} ${document.number || ""}`.trim();
      items.push({ id: message.id, at: message.createdAt, title, detail: "Shared with client", kind });
      if (kind === "contract" && document.client_signed_at && !Number.isNaN(Date.parse(document.client_signed_at))) {
        items.push({ id: `${message.id}-signed`, at: document.client_signed_at, title, detail: "Signed by client", kind });
      }
      if (kind === "form") {
        const form = formsById.get(document.id);
        if (form?.status === "Completed" && form.completed_at) {
          items.push({ id: `${message.id}-completed`, at: form.completed_at, title, detail: "Completed by client", kind });
        }
      }
    } else if (message.sender === "admin") {
      const proposal = parseProposal(message.body);
      if (proposal) items.push({ id: message.id, at: message.createdAt, title: proposal.title, detail: "Proposal shared with client", kind: "proposal" });
    } else if (message.sender === "client") {
      items.push({ id: message.id, at: message.createdAt, title: "Client message", detail: "Sent to HMP", kind: "message" });
    }
  }
  for (const item of seatingItems) items.push({ ...item, kind: "seating" });
  return items.sort((a, b) => Date.parse(b.at || "") - Date.parse(a.at || ""));
};
