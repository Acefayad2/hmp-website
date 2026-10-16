import { parseProposal } from "./proposal-ui.js";

export const hubSections = [
  ["all", "All"],
  ["messages", "Messages"],
  ["proposals", "Proposals"],
  ["invoices", "Invoices"],
  ["contracts", "Contracts"],
  ["forms", "Forms"],
  ["seating", "Guest Seating"],
];

export const hubSectionFor = (message) => {
  if (message?.sender !== "admin") return "messages";
  if (message?.document?.kind === "invoice") return "invoices";
  if (message?.document?.kind === "contract") return "contracts";
  if (message?.document?.kind === "form") return "forms";
  if (message?.document?.kind === "seating") return "seating";
  if (message?.sender === "admin" && parseProposal(message.body)) return "proposals";
  return "messages";
};

export const hubMessages = (messages = [], section = "all") =>
  section === "all" ? messages : messages.filter((message) => hubSectionFor(message) === section);

export const renderHubTabs = (container, messages, selected, onSelect, { showEmptySeating = false } = {}) => {
  container.replaceChildren();
  for (const [section, label] of hubSections) {
    const count = hubMessages(messages, section).length;
    if (section === "seating" && !count && !showEmptySeating) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hub-tab";
    button.setAttribute("aria-pressed", String(selected === section));
    button.textContent = `${label} (${count})`;
    button.addEventListener("click", () => onSelect(section));
    container.append(button);
  }
};
