const money = value => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(value) || 0);
const fieldLabels = {
  client_name:"Prepared for",issue_date:"Issue date",due_date:"Due date",effective_date:"Effective date",
  event_name:"Event",event_date:"Event date",event_address:"Event address",event_location:"Event location",
  services:"Services",scope_of_work:"Scope of services",payment_terms:"Payment terms",
  cancellation_terms:"Cancellation and rescheduling",additional_terms:"Additional terms",notes:"Notes",
  hmp_signature_name:"HMP representative",hmp_signed_at:"HMP signature date",
  client_signature_name:"Client signature",client_signed_at:"Client signature date",
};

export function renderDocumentCard(copy) {
  if (!copy || !["invoice","contract"].includes(copy.kind)) return null;
  const kind=copy.kind === "invoice" ? "Invoice" : "Contract";
  const card=document.createElement("section");card.className="sent-document";
  const heading=document.createElement("h3");heading.textContent=`${kind} ${copy.number || ""}`;
  const amount=document.createElement("p");amount.className="sent-document-total";
  amount.textContent=`${copy.kind === "invoice" ? "Total" : "Agreement value"}: ${money(copy.kind === "invoice" ? copy.total : copy.total_amount)}`;
  const details=document.createElement("details"), summary=document.createElement("summary");
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
  details.append(content);card.append(heading,amount,details);return card;
}
