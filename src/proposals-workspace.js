import { parseProposal, renderProposalCard } from "../proposal-ui.js";
import { searchText } from "../page-search.js";

export const collectProposals = (threads = []) => threads.flatMap((thread) =>
  (thread.messages || []).flatMap((message) => {
    if (message.sender !== "admin") return [];
    const proposal = parseProposal(message.body);
    return proposal ? [{ thread, message, proposal }] : [];
  }),
).sort((a, b) => String(b.message.createdAt || "").localeCompare(String(a.message.createdAt || "")));

export const groupProposalVersions = (records) => {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.thread.id}:${record.proposal.lineageId || record.message.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()].map((versions) => versions.sort((a, b) =>
    (b.proposal.version - a.proposal.version) || String(b.message.createdAt || "").localeCompare(String(a.message.createdAt || ""))));
};

let renderedSignature = "";

export const renderProposalsWorkspace = (threads, openConversation, editProposal = () => {}) => {
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
  const groups = groupProposalVersions(collectProposals(threads));
  const records = groups.map((versions) => versions[0]);
  document.querySelector("#proposal-workspace-empty").hidden = records.length > 0;
  document.querySelector("#proposal-workspace-count").textContent = `${records.length} proposal${records.length === 1 ? "" : "s"}`;
  const signature = JSON.stringify(groups.flat().map(({ thread, message }) => [thread.id, thread.clientName, thread.clientEmail, message.id, message.body, message.createdAt]));
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  const list = document.querySelector("#proposal-workspace-list");
  const expanded = new Set([...list.querySelectorAll("details[open]")].map((item) => item.dataset.proposalId));
  list.replaceChildren();
  groups.forEach((versions) => {
    const { thread, message, proposal } = versions[0];
    const record = document.createElement("details");
    record.className = "proposal-record";
    record.dataset.proposalId = proposal.lineageId || message.id;
    record.dataset.searchText = searchText(thread.clientEmail, thread.service, proposal.serviceFee, message.createdAt);
    record.open = expanded.has(record.dataset.proposalId);
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = proposal.version > 1 ? `${proposal.title} · Version ${proposal.version}` : proposal.title;
    const client = document.createElement("span");
    client.textContent = thread.clientName;
    const sent = document.createElement("span");
    const date = new Date(message.createdAt);
    const sentDate = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(proposal.serviceFee);
    sent.textContent = sentDate || "—";
    const price = document.createElement("span");
    price.textContent = amount;
    summary.append(title, client, sent, price);
    const content = document.createElement("div");
    content.className = "proposal-record-content";
    const conversation = document.createElement("button");
    conversation.type = "button";
    conversation.className = "text-button";
    conversation.textContent = "Open client conversation";
    conversation.addEventListener("click", () => openConversation(thread.id));
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
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "text-button";
    edit.textContent = "Edit and resend";
    edit.addEventListener("click", () => editProposal(versions[0], versions));
    content.append(renderProposalCard(proposal), edit, conversation, copy, status);
    if (versions.length > 1) {
      const history = document.createElement("details");
      history.className = "proposal-version-history";
      const historyTitle = document.createElement("summary");
      historyTitle.textContent = `Version history (${versions.length})`;
      history.append(historyTitle);
      versions.slice(1, 5).forEach((older) => {
        const row = document.createElement("div");
        const label = document.createElement("span");
        label.textContent = `Version ${older.proposal.version} · ${new Date(older.message.createdAt).toLocaleDateString("en-US")}`;
        const restore = document.createElement("button");
        restore.type = "button";
        restore.className = "text-button";
        restore.textContent = "Use for new version";
        restore.addEventListener("click", () => editProposal(older, versions));
        row.append(label, restore);
        history.append(row);
      });
      if (versions.length > 5) {
        const archive = document.createElement("details");
        const archiveTitle = document.createElement("summary");
        archiveTitle.textContent = `${versions.length - 5} older archived versions`;
        archive.append(archiveTitle);
        versions.slice(5).forEach((older) => {
          const row = document.createElement("div");
          const label = document.createElement("span");
          label.textContent = `Version ${older.proposal.version} · ${new Date(older.message.createdAt).toLocaleDateString("en-US")}`;
          const restore = document.createElement("button");
          restore.type = "button";
          restore.className = "text-button";
          restore.textContent = "Use for new version";
          restore.addEventListener("click", () => editProposal(older, versions));
          row.append(label, restore);
          archive.append(row);
        });
        history.append(archive);
      }
      content.append(history);
    }
    record.append(summary, content);
    list.append(record);
  });
};
