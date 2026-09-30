import { installPageSearch } from "../page-search.js";

const sections = [
  ["messages", "Search messages", "Client, email, message text, filename…", ".thread-row", ["thread-list"]],
  ["proposals", "Search proposals", "Client, email, proposal, service, amount…", ".proposal-record", ["proposal-workspace-list"]],
  ["forms", "Search forms", "Form name, client, email, status…", ".client-form-card, #receipt-template, #information-list .agreement-row", ["client-google-forms", "information-list"]],
  ["invoice", "Search invoices", "Invoice number, client, event, status…", ".invoice-list-row", ["invoice-list"]],
  ["contract", "Search contracts", "Client, email, contract, service, status…", ".contract-list-row, .agreement-template, .agreement-row", ["contract-list", "agreement-template-list", "agreement-list"]],
  ["reviews", "Search reviews", "Client, review text, service, request status…", ".review-list-row, .archived-review, #review-requests-list .agreement-row", ["review-list", "review-archive-list", "review-requests-list"]],
];

for (const [section, label, placeholder, items, lists] of sections) {
  installPageSearch({
    root: document.querySelector(`#${section}-workspace`),
    id: `${section}-search`, label, placeholder, items,
    containers: lists.map(id => document.getElementById(id)),
  });
}
