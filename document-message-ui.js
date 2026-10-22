import { receiptHTML } from "./receipt-template.mjs";
import { expired, expiryLabel } from "./document-expiry.mjs";
const money = value => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(value) || 0);
const fieldLabels = {
  client_name:"Prepared for",issue_date:"Issue date",due_date:"Due date",effective_date:"Effective date",
  event_name:"Event",event_date:"Event date",event_address:"Event address",event_location:"Event location",
  services:"Services",scope_of_work:"Scope of services",payment_terms:"Payment terms",
  payment_status:"Payment status when shared",
  cancellation_terms:"Cancellation and rescheduling",additional_terms:"Additional terms",notes:"Notes",
  hmp_signature_name:"HMP representative",hmp_signed_at:"HMP signature date",
  client_signature_name:"Client signature",client_signed_at:"Client signature date",
};

export function printDocumentCopy(copy) {
  const card = renderDocumentCard(copy, { showActions: false, expanded: true });
  if (!card) return false;
  const popup = window.open("", "_blank", "popup");
  if (!popup) return false;
  const container = document.createElement("div");
  container.append(card);
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>HMP Document Copy</title><link rel="stylesheet" href="${location.origin}/document-message.css?v=20261022"><link rel="stylesheet" href="${location.origin}/agreement.css"></head><body class="document-print-body">${container.innerHTML}</body></html>`);
  popup.document.close();
  window.setTimeout(() => { popup.focus(); popup.print(); }, 700);
  return true;
}

export function renderDocumentCard(copy, { showActions = true, expanded = false, enforceExpiry = true } = {}) {
  if (!copy || !["invoice","contract","form","seating","receipt","proposal"].includes(copy.kind)) return null;
  if (copy.expired || (enforceExpiry && expired(copy.expiresAt))) {
    const card = document.createElement("section"); card.className = "sent-document";
    const text = document.createElement("p");
    text.textContent = `This ${copy.kind} link expired${copy.expiresAt ? ` on ${expiryLabel(copy.expiresAt)}` : ""}. Please contact HMP for access.`;
    card.append(text); return card;
  }
  const addExpiry = card => {
    if (copy.expiresAt) { const text = document.createElement("p"); text.textContent = `Link expires: ${expiryLabel(copy.expiresAt)}.`; card.append(text); }
    return card;
  };
  if (copy.kind === "receipt") {
    const card = document.createElement("section"); card.className = "sent-document";
    const heading = document.createElement("h3"); heading.textContent = `Payment receipt ${copy.number || ""}`; card.append(heading);
    const details = document.createElement("details"), summary = document.createElement("summary");
    summary.textContent = "View receipt"; details.open = expanded; details.append(summary);
    const content = document.createElement("div"); content.innerHTML = receiptHTML(copy.receipt); details.append(content);
    if (showActions) {
      const button = document.createElement("button"), status = document.createElement("p"); button.type = "button"; button.textContent = "Print / Save PDF";
      button.onclick = () => { status.textContent = printDocumentCopy(copy) ? "" : "Allow pop-ups, then try again."; };
      details.append(button, status);
    }
    card.append(details); return addExpiry(card);
  }
  if (copy.kind === "seating") {
    const card = document.createElement("section"); card.className = "sent-document";
    const heading = document.createElement("h3"); heading.textContent = "Guest Seating Experience";
    const description = document.createElement("p"); description.textContent = "Manage the guest list for this event in your private Guest Seating portal.";
    card.append(heading, description);
    if (typeof copy.url === "string" && /^https:\/\/seating\.hmpeds\.com\/client\/[A-Za-z0-9-]+\/[A-Za-z0-9_-]+$/.test(copy.url)) {
      const link = document.createElement("a"); link.href = copy.url; link.textContent = "Open Guest Seating portal";
      link.target = "_blank"; link.rel = "noopener noreferrer"; card.append(link);
    }
    return addExpiry(card);
  }
  if (copy.kind === "form") {
    const card=document.createElement("section");card.className="sent-document";
    const heading=document.createElement("h3");heading.textContent=String(copy.title || "Client form");
    const status=document.createElement("p");status.textContent=`Status when shared: ${copy.status || "Sent"}`;
    card.append(heading,status);
    if (typeof copy.url === "string" && /^https:\/\/hmpeds\.com\/agreement#token=[A-Za-z0-9_-]+$/.test(copy.url)) {
      const link=document.createElement("a");link.href=copy.url;link.textContent="Open form";
      link.target="_blank";link.rel="noopener noreferrer";card.append(link);
    }
    return addExpiry(card);
  }
  const kind=copy.kind === "invoice" ? "Invoice" : "Contract";
  const card=document.createElement("section");card.className="sent-document";
  const heading=document.createElement("h3");heading.textContent=`${kind} ${copy.number || ""}`;
  const amount=document.createElement("p");amount.className="sent-document-total";
  amount.textContent=`${copy.kind === "invoice" ? "Total" : "Agreement value"}: ${money(copy.kind === "invoice" ? copy.total : copy.total_amount)}`;
  const details=document.createElement("details"), summary=document.createElement("summary");
  details.open = expanded;
  summary.textContent=`View ${copy.kind}`;details.append(summary);
  const content=document.createElement("div");content.className="sent-document-content";
  const note=document.createElement("p");note.textContent="Copy as sent. Later edits or payment/signature updates are not reflected in this copy.";content.append(note);
  const fields=document.createElement("dl");
  for(const [key,label] of Object.entries(fieldLabels)) {
    if(copy[key] == null || copy[key] === "") continue;
    const term=document.createElement("dt"), value=document.createElement("dd");
    term.textContent=label;value.textContent=String(copy[key]);fields.append(term,value);
  }
  content.append(fields);
  if(copy.kind === "invoice") {
    const items=document.createElement("ol");items.className="sent-document-items";
    for(const item of Array.isArray(copy.items) ? copy.items : []) {
      const row=document.createElement("li"), description=document.createElement("p"), value=document.createElement("p");
      description.textContent=item.description;value.textContent=`${item.quantity} × ${money(item.rate)} — ${money(item.amount)}`;
      row.append(description,value);items.append(row);
    }
    const totals=document.createElement("p");
    totals.textContent=`Subtotal: ${money(copy.subtotal)}\nDiscount: ${money(copy.discount_amount)}\nTax (${Number(copy.tax_rate)||0}%): ${money(copy.tax_amount)}\nTotal: ${money(copy.total)}`;
    content.append(items,totals);
  } else {
    const retainer=document.createElement("p");retainer.textContent=`Retainer: ${money(copy.retainer_amount)}`;content.append(retainer);
  }
  if (showActions) {
    const actions=document.createElement("div");actions.className="sent-document-actions";
    const button=document.createElement("button");button.type="button";button.textContent="Print / Save PDF";
    const status=document.createElement("p");status.setAttribute("role","status");
    button.addEventListener("click", () => {
      status.textContent=printDocumentCopy(copy) ? "" : "Allow pop-ups for this site, then choose Print / Save PDF again.";
    });
    actions.append(button,status);content.append(actions);
  }
  details.append(content);card.append(heading,amount,details);return addExpiry(card);
}
