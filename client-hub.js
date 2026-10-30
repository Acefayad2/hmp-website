import { parseProposal } from "./proposal-ui.js";
import {latestPublishedDocuments} from "./document-versions.mjs";
import {expiryLabel} from "./document-expiry.mjs";

export function clientAccessNotice(thread, now = Date.now()) {
  if (thread?.archivedAt) return "Archived — client access to this hub is disabled. Restore to return to the saved link settings. Separate document and Guest Seating links keep their own settings.";
  const expires = Date.parse(thread?.expiresAt);
  if (!Number.isFinite(expires)) return "Client access expiration is unavailable. Check the link expiration before sharing.";
  const date = expiryLabel(thread.expiresAt);
  if (expires <= now) return `Client access expired: ${date}.`;
  if (!thread.active) return `Client access is inactive. Saved expiration: ${date}.`;
  return `Client access expires: ${date}.`;
}

export const hubSections = [
  ["all", "Overview"],
  ["messages", "Messages"],
  ["proposals", "Proposals"],
  ["invoices", "Invoices"],
  ["receipts", "Receipts"],
  ["contracts", "Contracts"],
  ["forms", "Forms"],
  ["seating", "Guest Seating"],
];

export const hubSectionFor = (message) => {
  if (message?.sender !== "admin") return "messages";
  if (message?.document?.kind === "invoice") return "invoices";
  if (message?.document?.kind === "receipt") return "receipts";
  if (message?.document?.kind === "proposal") return "proposals";
  if (message?.document?.kind === "contract") return "contracts";
  if (message?.document?.kind === "form") return "forms";
  if (message?.document?.kind === "seating") return "seating";
  if (message?.sender === "admin" && parseProposal(message.body)) return "proposals";
  return "messages";
};

export const hubMessages = (messages = [], section = "all") =>
  section === "all" ? latestPublishedDocuments(messages) : latestPublishedDocuments(messages).filter((message) => hubSectionFor(message) === section);

export const renderHubTabs = (container, messages, selected, onSelect, { showEmptySeating = false, showActivity = false, showNotes = false } = {}) => {
  container.replaceChildren();
  const sections = [...hubSections, ...(showActivity ? [["activity", "Activity"]] : []), ...(showNotes ? [["notes", "Notes"]] : [])];
  for (const [section, label] of sections) {
    const count = hubMessages(messages, section).length;
    if (section === "seating" && !count && !showEmptySeating) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hub-tab";
    button.setAttribute("aria-pressed", String(selected === section));
    button.textContent = ["activity", "notes"].includes(section) ? label : `${label} (${count})`;
    button.addEventListener("click", () => onSelect(section));
    container.append(button);
  }
};
