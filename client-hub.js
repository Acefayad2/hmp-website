import { parseProposal } from "./proposal-ui.js";
import {latestPublishedDocuments} from "./document-versions.mjs";

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

export const renderHubTabs = (container, messages, selected, onSelect, { showEmptySeating = false, showActivity = false } = {}) => {
  container.replaceChildren();
  const sections = showActivity ? [...hubSections, ["activity", "Activity"]] : hubSections;
  for (const [section, label] of sections) {
    const count = hubMessages(messages, section).length;
    if (section === "seating" && !count && !showEmptySeating) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hub-tab";
    button.setAttribute("aria-pressed", String(selected === section));
    button.textContent = section === "activity" ? label : `${label} (${count})`;
    button.addEventListener("click", () => onSelect(section));
    container.append(button);
  }
};
