import { parseProposal, renderProposalCard } from "../proposal-ui.js";
import { searchText } from "../page-search.js";

export const collectProposals = (threads = []) => threads.flatMap((thread) =>
  (thread.messages || []).flatMap((message) => {
    if (message.sender !== "admin") return [];
    const proposal = parseProposal(message.body);
    return proposal ? [{ thread, message, proposal }] : [];
  }),
).sort((a, b) => String(b.message.createdAt || "").localeCompare(String(a.message.createdAt || "")));

let renderedSignature = "";

export const renderProposalsWorkspace = (threads, drafts, openConversation, openDraft) => {
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
  const sentRecords = collectProposals(threads);
  const draftRecords = drafts.flatMap((draft) => {
    const thread = threads.find((candidate) => candidate.id === draft.conversationId);
    return thread ? [{ thread, draft, proposal: draft.content }] : [];
  });
  const records = [...draftRecords, ...sentRecords];
  document.querySelector("#proposal-workspace-empty").hidden = records.length > 0;
  document.querySelector("#proposal-workspace-count").textContent = `${draftRecords.length} draft${draftRecords.length === 1 ? "" : "s"} · ${sentRecords.length} sent`;
  const signature = JSON.stringify(records.map(({ thread, message, draft }) => [thread.id, thread.clientName, thread.clientEmail, message?.id || draft.id, message?.body || draft.content, message?.createdAt || draft.updatedAt]));
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  const list = document.querySelector("#proposal-workspace-list");
  const expanded = new Set([...list.querySelectorAll("details[open]")].map((item) => item.dataset.proposalId));
  list.replaceChildren();
  records.forEach(({ thread, message, draft, proposal }) => {
    const record = document.createElement("details");
    record.className = "proposal-record";
    record.dataset.proposalId = message?.id || draft.id;
    record.dataset.searchText = searchText(thread.clientEmail, thread.service, proposal.serviceFee, message?.createdAt || draft.updatedAt, draft ? "draft" : "sent");
    record.open = expanded.has(record.dataset.proposalId);
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = proposal.title || "Untitled proposal";
    const client = document.createElement("span");
    client.textContent = thread.clientName;
    const sent = document.createElement("span");
    const date = new Date(message?.createdAt || draft.updatedAt);
    const sentDate = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(proposal.serviceFee);
    sent.textContent = draft ? `Draft · ${sentDate || "saved"}` : sentDate || "—";
    const price = document.createElement("span");
    price.textContent = amount;
    summary.append(title, client, sent, price);
    const content = document.createElement("div");
    content.className = "proposal-record-content";
    const conversation = document.createElement("button");
    conversation.type = "button";
    conversation.className = "text-button";
    conversation.textContent = draft ? "Edit draft" : "Open client conversation";
    conversation.addEventListener("click", () => draft ? openDraft(draft) : openConversation(thread.id));
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "text-button";
    copy.textContent = thread.active ? "Copy client link" : "Client link expired";
    copy.disabled = !thread.active;
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(thread.clientUrl);
        status.textContent = "Private portal link copied. Text it only to this client.";
      } catch { status.textContent = "Copying was blocked. Open the conversation to copy its link."; }
    });
    content.append(renderProposalCard(proposal), conversation);
    if (!draft) content.append(copy, status);
    record.append(summary, content);
    list.append(record);
  });
};
