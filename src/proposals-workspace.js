import { parseProposal, renderProposalCard } from "../proposal-ui.js";

export const collectProposals = (threads = []) => threads.flatMap((thread) =>
  (thread.messages || []).flatMap((message) => {
    if (message.sender !== "admin") return [];
    const proposal = parseProposal(message.body);
    return proposal ? [{ thread, message, proposal }] : [];
  }),
).sort((a, b) => String(b.message.createdAt || "").localeCompare(String(a.message.createdAt || "")));

let renderedSignature = "";

export const renderProposalsWorkspace = (threads, openConversation) => {
  const select = document.querySelector("#proposal-client-select");
  const selected = select.value;
  const optionsSignature = JSON.stringify(threads.map(({ id, clientName, clientEmail }) => [id, clientName, clientEmail]));
  if (select.dataset.signature !== optionsSignature) {
    select.replaceChildren(new Option("Choose a client", ""));
    threads.forEach((thread) => select.add(new Option(`${thread.clientName} · ${thread.clientEmail}`, thread.id)));
    select.value = threads.some((thread) => thread.id === selected) ? selected : "";
    select.dataset.signature = optionsSignature;
  }
  document.querySelector("#proposal-workspace-create").disabled = !select.value;
  const records = collectProposals(threads);
  document.querySelector("#proposal-workspace-empty").hidden = records.length > 0;
  document.querySelector("#proposal-workspace-count").textContent = `${records.length} sent proposal${records.length === 1 ? "" : "s"}`;
  const signature = JSON.stringify(records.map(({ thread, message }) => [thread.id, thread.clientName, message.id, message.body, message.createdAt]));
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  const list = document.querySelector("#proposal-workspace-list");
  const expanded = new Set([...list.querySelectorAll("details[open]")].map((item) => item.dataset.proposalId));
  list.replaceChildren();
  records.forEach(({ thread, message, proposal }) => {
    const record = document.createElement("details");
    record.className = "proposal-record";
    record.dataset.proposalId = message.id;
    record.open = expanded.has(message.id);
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = `${thread.clientName} — ${proposal.title}`;
    const meta = document.createElement("span");
    const date = new Date(message.createdAt);
    const sentDate = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(proposal.serviceFee);
    meta.textContent = `${amount} · Sent${sentDate ? ` ${sentDate}` : ""}`;
    summary.append(title, meta);
    const content = document.createElement("div");
    content.className = "proposal-record-content";
    const conversation = document.createElement("button");
    conversation.type = "button";
    conversation.className = "text-button";
    conversation.textContent = "Open client conversation";
    conversation.addEventListener("click", () => openConversation(thread.id));
    content.append(renderProposalCard(proposal), conversation);
    record.append(summary, content);
    list.append(record);
  });
};
