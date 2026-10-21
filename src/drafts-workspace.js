import { agreementTemplates } from "../agreement-schema.mjs";
import { informationTemplates } from "../information-form-schema.mjs";
import { searchText } from "../page-search.js";

const formTitles = new Map([...agreementTemplates, ...informationTemplates].map(template => [template.id, template.title]));
const informationIds = new Set(informationTemplates.map(template => template.id));
const activeDraft = row => row.status === "Draft" && !row.deletedAt && !row.archivedAt;

export function collectDraftGroups({ proposals = [], invoices = [], contracts = [], forms = [], receipts = [] } = {}) {
  const groups = [
    { kind: "proposal", title: "Proposals", rows: proposals.map(row => ({
      id: row.id, title: row.payload?.title || "Service proposal", client: row.payload?.clientName || "Client not named",
      detail: row.payload?.eventDate || "Event date not set", updatedAt: row.updatedAt || row.createdAt,
    })) },
    { kind: "invoice", title: "Invoices", rows: invoices.filter(activeDraft).map(row => ({
      id: row.id, title: row.invoiceNumber || "Draft invoice", client: row.clientName || "Client not named",
      detail: row.eventName || "Event not named", updatedAt: row.updatedAt || row.createdAt,
    })) },
    { kind: "receipt", title: "Payment receipts", rows: receipts.map(row => ({
      id: row.id, title: row.payload?.receiptMode === "standalone" ? `Standalone receipt${row.payload.receiptNumber ? ` — ${row.payload.receiptNumber}` : ""}` : row.invoiceNumber ? `Receipt for ${row.invoiceNumber}` : "Payment receipt — invoice not selected",
      client: row.clientName || "Client not selected", detail: row.eventName || row.payload?.reference || "Unfinished receipt",
      updatedAt: row.updatedAt || row.createdAt,
    })) },
    { kind: "contract", title: "Contracts", rows: contracts.filter(activeDraft).map(row => ({
      id: row.id, title: row.contractNumber || "Draft contract", client: row.clientName || "Client not named",
      detail: row.eventName || "Event not named", updatedAt: row.updatedAt || row.createdAt,
    })) },
    { kind: "form", title: "Client forms & agreements", rows: forms.filter(row => row.status === "Draft" && formTitles.has(row.template_id)).map(row => ({
      id: row.id, title: formTitles.get(row.template_id), client: row.client_name || "Client not named",
      detail: row.client_email || "Email not set", updatedAt: row.updated_at || row.created_at,
      informationForm: informationIds.has(row.template_id),
    })) },
  ];
  groups.forEach(group => group.rows.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))));
  return groups;
}

export function renderDraftGroups(root, groups, openDraft) {
  root.replaceChildren();
  groups.forEach(group => {
    const section = document.createElement("section");
    section.className = "draft-category";
    const heading = document.createElement("h3");
    heading.textContent = `${group.title} (${group.rows.length})`;
    section.append(heading);
    if (!group.rows.length) {
      const empty = document.createElement("p");
      empty.className = "draft-category-empty";
      empty.textContent = "No saved drafts in this category.";
      section.append(empty);
    }
    group.rows.forEach(row => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "draft-row";
      button.dataset.searchText = searchText(row.title, row.client, row.detail, row.updatedAt);
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = row.title;
      const client = document.createElement("small");
      client.textContent = `${row.client} · ${row.detail}`;
      text.append(title, client);
      const updated = document.createElement("time");
      updated.dateTime = row.updatedAt || "";
      const date = new Date(row.updatedAt || "");
      updated.textContent = Number.isNaN(date.getTime()) ? "Saved draft" : `Updated ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
      button.append(text, updated);
      button.addEventListener("click", () => openDraft(group.kind, row));
      section.append(button);
    });
    root.append(section);
  });
}
