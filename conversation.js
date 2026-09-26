import {
  appendAttachments,
  stageAttachments,
  clearStagedAttachments,
  pendingFiles,
  renderAttachmentPreviews,
  setAttachmentBusy,
  selectedFiles,
  updateAttachmentSummary,
  uploadAttachments,
} from "./attachment-ui.js?v=20260923-2";
import { parseProposal, renderProposalCard } from "./proposal-ui.js?v=20260915-1";
import { renderDocumentCard } from "./document-message-ui.js?v=20260923-1";

const $ = (selector) => document.querySelector(selector);
const eventServiceLabel = (value = "") => String(value || "").replace(/\bCelebration Accessories\b/g, "Event Accessories").replace(/\bEvent Kit\b/g, "Celebration Kit");
const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
let loading = false;
let renderedMessageSignature = "";

const getMessageSignature = (messages = []) => JSON.stringify(messages.map((message) => [
  message.id,
  message.sender,
  message.body,
  message.document,
  message.createdAt,
  (message.attachments || []).map((attachment) => [
    attachment.id,
    attachment.path,
    attachment.name,
    attachment.type,
    attachment.size,
  ]),
]));

const formatDate = (value, includeTime = false) => {
  if (!value) return "To be confirmed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "To be confirmed";
  return new Intl.DateTimeFormat("en-US", includeTime
    ? { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" }
    : { month:"long", day:"numeric", year:"numeric" }).format(date);
};

const showError = () => {
  $("#conversation-title").textContent = "Private conversation unavailable";
  $("#conversation-error").hidden = false;
  $("#message-list").hidden = true;
  $("#message-empty").hidden = true;
  $("#message-form").hidden = true;
};

const renderMessages = (messages) => {
  const signature = getMessageSignature(messages);
  if (signature === renderedMessageSignature) return;
  renderedMessageSignature = signature;
  const list = $("#message-list");
  list.replaceChildren();
  messages.forEach((message) => {
    const article = document.createElement("article");
    article.className = `message ${message.sender === "client" ? "client" : "admin"}`;
    const name = document.createElement("strong");
    name.textContent = message.sender === "client" ? "You" : "HMP representative";
    const proposal = parseProposal(message.body);
    const copy = document.createElement("p");
    copy.textContent = message.body;
    const time = document.createElement("time");
    time.dateTime = message.createdAt;
    time.textContent = formatDate(message.createdAt, true);
    article.append(name);
    const documentCard=message.sender === "admin" ? renderDocumentCard(message.document) : null;
    if (documentCard) { article.classList.add("document-message"); article.append(documentCard); }
    else if (proposal) {
      article.classList.add("proposal-message");
      article.append(renderProposalCard(proposal));
    }
    else if (message.body) article.append(copy);
    appendAttachments(article, message.attachments);
    article.append(time);
    list.append(article);
  });
  list.hidden = messages.length === 0;
  $("#message-empty").hidden = messages.length > 0;
  if (messages.length) list.scrollTop = list.scrollHeight;
};

const loadConversation = async ({ quiet = false } = {}) => {
  if (!validToken || loading) return showError();
  loading = true;
  try {
    const response = await fetch("/api/hmp-conversation", {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Conversation unavailable");
    $("#conversation-title").textContent = `Conversation for ${data.conversation.clientName}`;
    $("#summary-service").textContent = eventServiceLabel(data.conversation.service);
    $("#summary-date").textContent = formatDate(data.conversation.celebrationDate);
    $("#conversation-summary").hidden = false;
    $("#conversation-error").hidden = true;
    $("#message-form").hidden = false;
    renderMessages(data.messages || []);
    if (!quiet) $("#message-input").focus();
  } catch {
    showError();
  } finally {
    loading = false;
  }
};

$("#message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#message-input");
  const button = event.currentTarget.querySelector("button[type=submit]");
  const message = input.value.trim();
  const attachmentInput = $("#message-attachments");
  if (attachmentInput.disabled) return;
  let files;
  try {
    files = selectedFiles(attachmentInput);
  } catch (error) {
    $("#message-status").textContent = error.message;
    return;
  }
  if (!message && !files.length) return;
  const requestId = globalThis.crypto.randomUUID();
  button.disabled = true;
  setAttachmentBusy(attachmentInput, $("#message-attachment-previews"), true);
  $("#message-status").textContent = files.length ? "Uploading attachments…" : "Sending…";
  try {
    const attachments = await uploadAttachments({
      files,
      messageId: requestId,
      prepare: async (payload) => {
        const response = await fetch("/api/hmp-conversation", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          credentials: "omit",
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Attachment could not be uploaded.");
        return data;
      },
    });
    $("#message-status").textContent = "Sending…";
    const response = await fetch("/api/hmp-conversation", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ message, requestId, attachments }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Message could not be sent.");
    input.value = "";
    clearStagedAttachments(attachmentInput);
    updateAttachmentSummary(attachmentInput, $("#message-attachment-summary"));
    renderAttachmentPreviews(
      attachmentInput,
      $("#message-attachment-previews"),
      $("#message-attachment-summary"),
    );
    $("#message-status").textContent = "Message sent securely.";
    await loadConversation({ quiet: true });
  } catch (error) {
    $("#message-status").textContent = error.message || "Message could not be sent.";
  } finally {
    button.disabled = false;
    setAttachmentBusy(attachmentInput, $("#message-attachment-previews"), false);
  }
});

$("#message-attachments").addEventListener("change", () => {
  const input = $("#message-attachments");
  stageAttachments(input);
  const summary = $("#message-attachment-summary");
  updateAttachmentSummary(input, summary);
  renderAttachmentPreviews(input, $("#message-attachment-previews"), summary);
});

window.addEventListener("beforeunload", (event) => {
  if (pendingFiles($("#message-attachments")).length) {
    event.preventDefault();
    event.returnValue = "";
  }
});

if (validToken) {
  loadConversation();
  setInterval(() => {
    if (document.visibilityState === "visible") loadConversation({ quiet: true });
  }, 12000);
} else {
  showError();
}
