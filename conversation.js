import {renderMessageText} from "./message-formatting.mjs";
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
import { parseProposal, renderProposalMessage } from "./proposal-ui.js?v=20261022-sharing";
import { renderDocumentCard } from "./document-message-ui.js?v=20261109-languages";
import { hubMessages, renderHubTabs } from "./client-hub.js?v=20261022-sharing";
import { appendLinkedText } from "./calendar-link.js?v=20261012-calendar";
import { parseCalendarDate } from "./calendar-date.mjs?v=20261012-inquiry-date";
import { clientHubLanguages, clientHubLanguage, collectTranslatableText, splitTranslationText, translationBatches } from "./client-hub-languages.mjs";
import { expiryLabel } from "./document-expiry.mjs";

const $ = (selector) => document.querySelector(selector);
const eventServiceLabel = (value = "") => String(value || "").replace(/\bCelebration Accessories\b/g, "Event Accessories").replace(/\bEvent Kit\b/g, "Celebration Kit");
const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
let loading = false;
let authBusy = false;
let loadVersion = 0;
let pinMode = "login";
let renderedMessageSignature = "";
let activeHubSection = "messages";
let activeLanguage = "en";
let currentMessages = [];
let translationVersion = 0;
const sourceText = new WeakMap();
const translationCache = new Map();
const linkedSection = new URLSearchParams(location.hash.slice(1)).get("section");
if (["proposals","invoices","contracts","forms","receipts"].includes(linkedSection)) activeHubSection = linkedSection;

const getMessageSignature = (messages = []) => JSON.stringify(messages.map((message) => [
  message.id,
  message.sender,
  message.body,
  message.document,
  message.createdAt,
  message.editedAt,
  message.textMessage,
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
  const date = parseCalendarDate(value);
  if (!date) return "To be confirmed";
  return new Intl.DateTimeFormat("en-US", includeTime
    ? { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" }
    : { month:"long", day:"numeric", year:"numeric" }).format(date);
};

const showError = (message = "This private link is invalid or expired. Please contact HMP for assistance.") => {
  $("#client-pin-form").hidden = true;
  $("#client-hub-controls").hidden = true;
  translationVersion++;
  setTranslationStatus();
  $("#conversation-summary").hidden = true;
  $("#message-list").replaceChildren();
  renderedMessageSignature = "";
  $("#conversation-title").textContent = "Private conversation unavailable";
  $("#conversation-error").hidden = false;
  $("#conversation-error p").textContent = message;
  $("#message-list").hidden = true;
  $("#message-empty").hidden = true;
  $("#message-form").hidden = true;
  $("#client-hub-tabs").hidden = true;
};

const showPin = (code) => {
  const wasHidden = $("#client-pin-form").hidden;
  pinMode = code === "CLIENT_PIN_SETUP" ? "setup" : "login";
  $("#conversation-title").textContent = pinMode === "setup" ? "Create your PIN" : "Welcome back";
  $("#client-pin-help").textContent = pinMode === "setup"
    ? "Choose a 6-digit PIN to protect this portal. Use your private link and PIN whenever you sign in."
    : "Enter your 6-digit PIN to view your messages and contact HMP.";
  $("#client-pin-submit").textContent = pinMode === "setup" ? "Create PIN and continue" : "Sign in";
  $("#client-pin").autocomplete = pinMode === "setup" ? "new-password" : "current-password";
  $("#client-pin-confirm-group").hidden = pinMode !== "setup";
  $("#client-pin-confirm").required = pinMode === "setup";
  $("#client-pin-form").hidden = false;
  $("#client-hub-controls").hidden = true;
  translationVersion++;
  setTranslationStatus();
  $("#conversation-error").hidden = true;
  $("#conversation-summary").hidden = true;
  $("#message-form").hidden = true;
  $("#message-empty").hidden = true;
  $("#message-list").hidden = true;
  $("#client-hub-tabs").hidden = true;
  $("#message-list").replaceChildren();
  renderedMessageSignature = "";
  if (wasHidden) {
    $("#client-pin").value = "";
    $("#client-pin-confirm").value = "";
    $("#client-pin-status").textContent = "";
    $("#client-pin").focus();
  }
};

const pinRequired = (data) => ["CLIENT_PIN_SETUP", "CLIENT_PIN_REQUIRED"].includes(data.code);

const setTranslationStatus = (message = "") => {
  const status = $("#client-hub-translation-status");
  status.textContent = message;
  status.hidden = !message;
};

const translateHub = async () => {
  const version = ++translationVersion;
  const roots = [$(".conversation-header span"), $(".conversation-intro"), $(".conversation-panel-heading"),
    $("#conversation-summary"), $("#client-hub-tabs"), $("#message-empty"), $("#message-form"),
    $("#message-list")];
  const nodes = collectTranslatableText(roots);
  for (const node of nodes) {
    if (!sourceText.has(node)) sourceText.set(node, node.textContent);
    node.textContent = sourceText.get(node);
  }
  document.documentElement.lang = activeLanguage;
  document.documentElement.dir = ["ar", "ar-EG", "ur"].includes(activeLanguage) ? "rtl" : "ltr";
  if (activeLanguage === "en") { setTranslationStatus(); return; }
  setTranslationStatus("Translating this hub and its document viewing copies…");
  try {
    const segments = nodes.flatMap((node) => splitTranslationText(sourceText.get(node)).map((text) => ({ node, textContent: text })));
    for (const batch of translationBatches(segments)) {
      const originals = batch.map((segment) => segment.textContent);
      const pending = originals.filter((value) => !translationCache.has(`${activeLanguage}\0${value}`));
      if (pending.length) {
        const response = await fetch("/api/hmp-client-translation", {
          method: "POST", credentials: "same-origin",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ language: activeLanguage, texts: pending }),
        });
        const data = await response.json().catch(() => ({}));
        if (pinRequired(data)) { showPin(data.code); return; }
        if (!response.ok) throw new Error(data.error || "Translation is unavailable. Please try again.");
        pending.forEach((value, index) => translationCache.set(`${activeLanguage}\0${value}`, data.translations[index]));
        while (translationCache.size > 800) translationCache.delete(translationCache.keys().next().value);
      }
      if (version !== translationVersion) return;
    }
    if (version === translationVersion) {
      const translated = new Map();
      for (const { node, textContent } of segments) translated.set(node, (translated.get(node) || "") + (translationCache.get(`${activeLanguage}\0${textContent}`) || textContent));
      for (const [node, value] of translated) node.textContent = value;
      setTranslationStatus("Translated reference view. Signed and issued originals remain unchanged; use English to view the original.");
    }
  } catch (error) {
    if (version === translationVersion) setTranslationStatus(error instanceof Error ? error.message : "Translation is unavailable. Please try again.");
  }
};

const renderLanguageOptions = () => {
  const query = $("#client-hub-language-search").value.trim().toLocaleLowerCase();
  const list = $("#client-hub-language-options");
  list.replaceChildren();
  for (const [code, label, native] of clientHubLanguages) {
    if (!`${label} ${native}`.toLocaleLowerCase().includes(query)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(activeLanguage === code));
    const name = document.createElement("span"), description = document.createElement("small");
    name.textContent = native; description.textContent = label;
    button.append(name, description);
    button.addEventListener("click", () => {
      activeLanguage = code;
      $("#client-hub-language-label").textContent = `Language: ${clientHubLanguage(code)[2]}`;
      $("#client-hub-language").open = false;
      $("#client-hub-language-search").value = "";
      renderLanguageOptions();
      renderedMessageSignature = "";
      renderMessages(currentMessages);
    });
    list.append(button);
  }
  if (!list.childElementCount) list.textContent = "No languages found.";
};

$("#client-hub-language-search").addEventListener("input", renderLanguageOptions);
$("#client-hub-language-search").addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("#client-hub-language").open = false;
});
renderLanguageOptions();

const renderMessages = (messages) => {
  currentMessages = messages;
  const visible = hubMessages(messages, activeHubSection);
  const signature = `${activeLanguage}:${activeHubSection}:${getMessageSignature(messages)}`;
  if (signature === renderedMessageSignature) return;
  renderedMessageSignature = signature;
  const focusedTab = document.activeElement?.classList?.contains("hub-tab")
    ? [...$("#client-hub-tabs").children].indexOf(document.activeElement) : -1;
  renderHubTabs($("#client-hub-tabs"), messages, activeHubSection, (section) => {
    activeHubSection = section;
    renderMessages(messages);
  });
  if (focusedTab >= 0) $("#client-hub-tabs").children[focusedTab]?.focus();
  const list = $("#message-list");
  list.replaceChildren();
  visible.forEach((message) => {
    const article = document.createElement("article");
    article.className = `message ${message.sender === "client" ? "client" : "admin"}`;
    const name = document.createElement("strong");
    name.textContent = message.sender === "client" ? "You" : "HMP representative";
    const proposal = parseProposal(message.body);
    const copy = document.createElement("div");
    copy.className = "message-copy";
    if (message.sender === "admin") renderMessageText(copy, message.body, message.formatting);
    else copy.textContent = message.body;
    const time = document.createElement("time");
    time.dateTime = message.createdAt;
    time.textContent = formatDate(message.createdAt, true);
    if (message.editedAt) time.textContent += " · Edited";
    article.append(name);
    const documentCard=message.sender === "admin" ? renderDocumentCard(message.document, { language: activeLanguage }) : null;
    if (documentCard) { article.classList.add("document-message"); article.append(documentCard); }
    else if (proposal) {
      article.classList.add("proposal-message");
      article.append(renderProposalMessage(proposal));
    }
    else if (message.body) article.append(copy);
    appendAttachments(article, message.attachments);
    if (message.textMessage) {
      const note = document.createElement("p");
      note.className = "message-text-note";
      note.textContent = "Sent by text";
      article.append(note);
    }
    article.append(time);
    list.append(article);
  });
  list.hidden = visible.length === 0;
  $("#message-empty").hidden = visible.length > 0;
  $("#message-empty h3").textContent = activeHubSection === "all" ? "Your private conversation starts here." : `No ${activeHubSection==="contracts"?"agreements":activeHubSection} in this event hub yet.`;
  if (visible.length) list.scrollTop = list.scrollHeight;
  if (activeLanguage !== "en") {
    for (const card of list.querySelectorAll(".sent-document")) {
      const note = document.createElement("p");
      note.className = "document-translation-note";
      note.textContent = "Translated reference copy. The original signed or issued English document remains unchanged. Print / Save PDF opens the original.";
      card.prepend(note);
      for (const button of card.querySelectorAll("button")) if (/Print \/ Save PDF/.test(button.textContent || "")) {
        button.textContent = "Print original / Save PDF";
        button.classList.add("document-print-original");
      }
    }
  }
  void translateHub();
};

const loadConversation = async ({ quiet = false } = {}) => {
  if (loading || authBusy) return;
  if (!validToken) return showError();
  loading = true;
  const version = ++loadVersion;
  try {
    const response = await fetch("/api/hmp-conversation", {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (version !== loadVersion) return;
    if (pinRequired(data)) { showPin(data.code); return; }
    if (!response.ok) throw new Error(data.error || "Conversation unavailable");
    $("#client-pin-form").hidden = true;
  $("#client-hub-controls").hidden = false;
    $("#conversation-title").textContent = `${data.conversation.clientName}’s Event Hub`;
    $("#summary-service").textContent = eventServiceLabel(data.conversation.service);
    $("#summary-date").textContent = formatDate(data.conversation.celebrationDate);
    $("#summary-expires").textContent = data.conversation.expiresAt ? expiryLabel(data.conversation.expiresAt) : "Contact HMP for access details";
    $("#conversation-summary").hidden = false;
    $("#conversation-error").hidden = true;
    $("#message-form").hidden = false;
    $("#client-hub-tabs").hidden = false;
    renderMessages(data.messages || []);
    if (!quiet) $("#message-input").focus();
  } catch (error) {
    if (version === loadVersion) showError(error.message);
  } finally {
    if (version === loadVersion) loading = false;
  }
};

$("#client-pin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#client-pin-submit");
  if (button.disabled) return;
  button.disabled = true;
  authBusy = true;
  loadVersion++;
  loading = false;
  $("#client-pin-status").textContent = "";
  try {
    const response = await fetch(`/api/hmp-conversation?pin=${pinMode}`, {
      method: "POST", credentials: "same-origin",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ pin: $("#client-pin").value, confirmPin: $("#client-pin-confirm").value }),
    });
    const data = await response.json();
    if (pinRequired(data)) showPin(data.code);
    if (!response.ok) throw new Error(data.error || "Sign-in failed.");
    $("#client-pin").value = "";
    $("#client-pin-confirm").value = "";
    authBusy = false;
    await loadConversation();
  } catch (error) { $("#client-pin-status").textContent = error.message || "Please try again."; }
  finally { button.disabled = false; authBusy = false; }
});

$("#client-sign-out").addEventListener("click", async () => {
  if (authBusy) return;
  authBusy = true;
  loadVersion++;
  loading = false;
  const response = await fetch("/api/hmp-conversation?pin=logout", {
    method: "POST", credentials: "same-origin", headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  authBusy = false;
  if (!response?.ok) { $("#message-status").textContent = "Sign-out could not be confirmed. Please try again."; return; }
  $("#message-input").value = "";
  clearStagedAttachments($("#message-attachments"));
  renderAttachmentPreviews($("#message-attachments"), $("#message-attachment-previews"), $("#message-attachment-summary"));
  showPin("CLIENT_PIN_REQUIRED");
});

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
  input.readOnly = true;
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
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (pinRequired(data)) showPin(data.code);
        if (!response.ok) throw new Error(data.error || "Attachment could not be uploaded.");
        return data;
      },
    });
    $("#message-status").textContent = "Sending…";
    const response = await fetch("/api/hmp-conversation", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ message, requestId, attachments }),
    });
    const data = await response.json().catch(() => ({}));
    if (pinRequired(data)) showPin(data.code);
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
    input.readOnly = false;
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadConversation({ quiet: true });
  });
  setInterval(() => {
    if (document.visibilityState === "visible") loadConversation({ quiet: true });
  }, 12000);
} else {
  showError();
}
