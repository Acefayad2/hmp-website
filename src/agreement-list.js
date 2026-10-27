import { agreementTemplates } from "../agreement-schema.mjs";
import { latestDocumentRows } from "../document-versions.mjs";
import { escape } from "../agreement-ui.mjs";
import { searchText } from "../page-search.js";

const dateLabel = value => {
  if (!value) return "Not provided";
  // Calendar dates must not move back a day in American time zones.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? "Not provided" : date.toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"});
};
const moneyLabel = value => value == null || String(value).trim() === "" || !Number.isFinite(Number(value))
  ? "Not provided"
  : new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(Number(value));

export function agreementListRows(contracts = [], agreements = []) {
  const manual = latestDocumentRows(contracts).map(row => ({
    id:row.id, kind:"contract", title:row.contractNumber || "Service agreement",
    subtitle:dateLabel(row.effectiveDate), client:row.clientName, email:row.clientEmail,
    eventDate:row.eventDate, value:row.totalAmount, status:row.status, created:row.createdAt || "",
    search:searchText(row.eventName, row.eventLocation, row.eventDate, row.clientPhone, row.services, row.scopeOfWork, row.totalAmount, row.paymentTerms, row.additionalTerms),
  }));
  const native = latestDocumentRows(agreements).flatMap(row => {
    const template = agreementTemplates.find(t => t.id === row.template_id && t.id !== "money-bank-verification");
    if (!template) return [];
    const value = row.template_id === "accessories" ? row.total_due
      : row.template_id === "customization-approval" ? row.approval_fee
      : row.template_id === "led-customization" ? row.customization_fee : row.service_fee;
    return [{id:row.id, kind:"agreement", title:row.document_title || template.title,
      subtitle:dateLabel(row.created_at), client:row.client_name, email:row.client_email,
      eventDate:row.event_date, value, status:row.status, created:row.created_at || "",
      search:searchText(row.event_name, row.event_date, row.completed_at, row.document_title, value),
    }];
  });
  // Dedupe revisions within each source, never across unrelated record types.
  return [...manual, ...native].sort((a, b) => b.created.localeCompare(a.created));
}

export function agreementRowsHTML(rows) {
  return rows.map(row => `<button class="invoice-list-row contract-list-row" type="button" data-${row.kind}-id="${escape(row.id)}" data-search-text="${escape(row.search)}">
    <span><strong>${escape(row.title)}</strong><small>${escape(row.subtitle)}</small></span>
    <span><strong>${escape(row.client || "Client not entered")}</strong><small>${escape(row.email || "")}</small></span>
    <span>${escape(dateLabel(row.eventDate))}</span>
    <span class="invoice-list-total">${escape(moneyLabel(row.value))}</span>
    <span class="status-pill">${escape(row.status)}</span>
  </button>`).join("");
}

const sources = {
  contracts:{rows:[], loading:true, error:""},
  agreements:{rows:[], loading:true, error:""},
};

export function updateAgreementList(source, update) {
  Object.assign(sources[source], update);
  const rows = agreementListRows(sources.contracts.rows, sources.agreements.rows);
  const list = document.querySelector("#contract-list");
  list.innerHTML = agreementRowsHTML(rows);
  list.hidden = rows.length === 0;
  const loading = Object.values(sources).some(item => item.loading);
  const errors = Object.values(sources).map(item => item.error).filter(Boolean);
  document.querySelector("#contract-empty").hidden = rows.length > 0 || loading || errors.length > 0;
  const message = document.querySelector("#agreement-list-message");
  message.classList.toggle("neutral", errors.length === 0);
  message.textContent = [...errors, ...(loading ? ["Loading agreements…"] : [])].join(" ");
  list.setAttribute("aria-busy", String(loading));
}
