import { loadAgreementForms, openAgreementDraft } from "./agreement-admin.js";
import { loadAdminWorkspace } from "./admin-startup.mjs";
import "./receipt-admin.js";
import { loadInformationForms, openInformationDraft } from "./client-forms.js";
import { collectDraftGroups, renderDraftGroups } from "./drafts-workspace.js";
import { renderProposalsWorkspace } from "./proposals-workspace.js";
import { groupDocumentVersions } from "./document-versions.js";
import { renderDocumentCard } from "../document-message-ui.js";
import { hubMessages, renderHubTabs } from "../client-hub.js";
import { clientActivityItems } from "../client-activity.js";
import { loadReviewRequests } from "./review-requests-admin.js";
import { inquiryGroups, inquiryFilterTitles } from "./inquiry-filters.mjs";
import "./admin-search.js";
import { matchesSearch, searchText } from "../page-search.js";
import { insertMessageSignature } from "./message-signature.mjs";
import { appendLinkedText, normalizeCalendarUrl } from "../calendar-link.js";
import { proposalEventType } from "./proposal-event-type.js";
import { createProposalDirtyState } from "./proposal-dirty-state.js";
import { parseCalendarDate } from "../calendar-date.mjs";
import {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  AUTH_EVENTS,
  requestPasswordRecovery,
  updateUser,
} from "@netlify/identity";
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
} from "../attachment-ui.js";
import {
  parseProposal,
  printProposal,
  renderProposalCard,
  renderProposalPreview,
  serializeProposal,
} from "../proposal-ui.js";

const $ = (selector) => document.querySelector(selector);
const eventServiceLabel = (value = "") => String(value || "").replace(/\bCelebration Accessories\b/g, "Event Accessories").replace(/\bEvent Kit\b/g, "Celebration Kit");
const authShell = $("#auth-shell");
const dashboard = $("#dashboard");
const loginForm = $("#login-form");
const passwordForm = $("#password-form");
const authMessage = $("#auth-message");
const passwordMessage = $("#password-message");
const inquiryList = $("#inquiry-list");
const emptyState = $("#empty-state");
const dialog = $("#inquiry-dialog");

let inquiries = [];
let activeInquiryFilter = "all";
let invoices = [];
let invoiceView = "active";
let invoiceItems = [];
let activeInvoiceId = "";
let invoiceEmailConfigured = false;
let contracts = [];
let activeContractId = "";
let contractEmailConfigured = false;
let inviteToken = "";
let activeInquiryId = "";
let reviews = [];
let activeReviewId = "";
let messageThreads = [];
let proposalDrafts = [];
let activeProposalLineageId = "";
let activeProposalVersion = 1;
let activeProposalDraftId = "";
let savedFormDrafts = [];
let activeThreadId = "";
let activeHubSection = "messages";
let activeActivityThreadId = "";
let activityFormsById = new Map();
let activitySeatingByThreadId = new Map();
let activitySeatingRequest = 0;
let availableHubForms = [];
let activeConversationUrl = "";
let messageSignature = "";
let messageSignatureLoaded = false;
let messageSignatureLoadPromise = null;
let renderedAdminThreadId = "";
let renderedAdminMessageSignature = "";
let activeWorkspaceView = "inquiries";
let dashboardSyncInProgress = false;
let dashboardSyncTimer = 0;

const DASHBOARD_SYNC_INTERVAL = 10_000;
const HMP_BOOKING_CALENDAR_URL = "https://calendar.app.google/CJn7HCVgHaqHM2fK6";

const syncSharedSession = async () => {
  const response = await fetch("/api/hmp-sso", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Shared HMP sign-in is unavailable.");
};

const workspaceViews = {
  inquiries: {
    title: "Inquiry dashboard",
  },
  messages: {
    title: "Client messages",
  },
  activity: {
    title: "Client activity",
  },
  drafts: {
    title: "Drafts",
  },
  proposals: {
    title: "Proposals",
  },
  invoices: {
    title: "Invoices & Contracts",
  },
  contracts: {
    title: "Invoices & Contracts",
  },
  forms: {
    title: "Forms",
  },
  reviews: {
    title: "Reviews",
  },
};

const escapeHTML = (value = "") =>
  String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ],
  );

const formatDate = (value, includeTime = false) => {
  const date = parseCalendarDate(value);
  if (!date) return value || "Not provided";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
};

const setMessage = (element, message, success = false) => {
  element.textContent = message;
  element.classList.toggle("success", success);
};

const setWorkspaceView = (requestedView, updateUrl = false) => {
  if (requestedView === "events") requestedView = "forms";
  const view = workspaceViews[requestedView] ? requestedView : "inquiries";
  if (view !== activeWorkspaceView && $("#proposal-editor-dialog").open && !closeProposalEditor()) return false;
  const config = workspaceViews[view];
  const isInquiries = view === "inquiries";
  const isMessages = view === "messages";
  const isActivity = view === "activity";
  const isDrafts = view === "drafts";
  const isProposals = view === "proposals";
  const isInvoices = view === "invoices";
  const isContracts = view === "contracts";
  const isForms = view === "forms";
  const isDocuments = isInvoices || isContracts;
  const isReviews = view === "reviews";
  activeWorkspaceView = view;

  $(".dashboard-header h1").textContent = config.title;
  $(".metrics").hidden = !isInquiries;
  $(".dashboard-grid").hidden = !isInquiries;
  $("#messages-workspace").hidden = !isMessages;
  $("#activity-workspace").hidden = !isActivity;
  $("#drafts-workspace").hidden = !isDrafts;
  $("#proposals-workspace").hidden = !isProposals;
  $("#document-tabs").hidden = !isDocuments;
  document.querySelectorAll("[data-document-view]").forEach((tab) => {
    const selected = tab.dataset.documentView === view;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  $("#invoice-workspace").hidden = !isInvoices;
  $("#contract-workspace").hidden = !isContracts;
  $("#forms-workspace").hidden = !isForms;
  $("#reviews-workspace").hidden = !isReviews;
  $("#workspace-empty").hidden = isInquiries || isMessages || isActivity || isDrafts || isProposals || isInvoices || isContracts || isForms || isReviews;
  if (!isInquiries && !isMessages && !isActivity && !isDrafts && !isProposals && !isInvoices && !isContracts && !isForms && !isReviews) {
    $("#workspace-empty-label").textContent = config.label;
    $("#workspace-empty-title").textContent = config.emptyTitle;
    $("#workspace-empty-copy").textContent = config.emptyCopy;
  }
  if (isContracts) loadAgreementForms();
  if (isForms) loadInformationForms();
  if (isMessages) loadMessageSignature().catch((error) => setMessage($("#message-signature-status"), error.message));
  if (isActivity) loadClientActivity().catch((error) => setMessage($("#activity-status"), error.message));
  if (isDrafts) loadDrafts().catch((error) => setMessage($("#drafts-status"), error.message));
  if (isProposals) {
    setMessage($("#proposal-workspace-status"), "Loading proposals…");
    loadMessages().then(() => setMessage($("#proposal-workspace-status"), "")).catch((error) => {
      setMessage($("#proposal-workspace-status"), `Proposals unavailable: ${error.message}`);
    });
  }
  if (isInvoices) {
    loadInvoices().catch((error) => {
      $("#invoice-empty").hidden = false;
      $("#invoice-empty h3").textContent = "Invoices unavailable";
      $("#invoice-empty p").textContent = error.message;
    });
  }
  if (isContracts) {
    loadContracts().catch((error) => {
      $("#contract-empty").hidden = false;
      $("#contract-empty h3").textContent = "Contracts unavailable";
      $("#contract-empty p").textContent = error.message;
    });
  }
  if (isMessages) {
    loadMessages().catch((error) => {
      $("#thread-empty").hidden = false;
      $("#thread-empty h3").textContent = "Messages unavailable";
      $("#thread-empty p").textContent = error.message;
    });
  }
  if (isReviews) {
    loadReviews().catch((error) => {
      $("#review-empty").hidden = false;
      $("#review-empty h3").textContent = "Reviews unavailable";
      $("#review-empty p").textContent = error.message;
    });
  }

  document.querySelectorAll("[data-workspace-view]").forEach((link) => {
    const isActive = link.dataset.workspaceGroup === "documents" ? isDocuments : link.dataset.workspaceView === view;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (updateUrl) {
    const url = view === "inquiries" ? "/admin" : `/admin?view=${view}`;
    history.pushState({ view }, "", url);
  }
  return true;
};

const showPasswordForm = (message) => {
  loginForm.hidden = true;
  passwordForm.hidden = false;
  if (message) setMessage(passwordMessage, message, true);
};

const renderMetrics = () => {
  const groups = inquiryGroups(inquiries);
  $("#metric-total").textContent = inquiries.length;
  $("#metric-new").textContent = groups.new.length;
  $("#metric-upcoming").textContent = groups.upcoming.length;
  $("#metric-guests").textContent = groups.largest[0]?.guestCount || "—";
};

const renderServiceFilter = () => {
  const select = $("#service-filter");
  const current = select.value;
  const services = [...new Set(inquiries.map((item) => eventServiceLabel(item.service)).filter(Boolean))].sort();
  select.innerHTML = '<option value="">All services</option>' + services
    .map((service) => `<option value="${escapeHTML(service)}">${escapeHTML(service)}</option>`)
    .join("");
  select.value = current;
};

const renderServiceMix = () => {
  const counts = inquiries.reduce((result, item) => {
    const service = eventServiceLabel(item.service) || "Not specified";
    result[service] = (result[service] || 0) + 1;
    return result;
  }, {});
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  $("#service-mix").innerHTML = entries.length
    ? entries
        .map(
          ([service, count]) => `
            <div class="mix-item">
              <div class="mix-heading"><span>${escapeHTML(service)}</span><strong>${count}</strong></div>
              <div class="mix-bar" aria-label="${escapeHTML(service)}: ${count}"><span style="width:${(count / max) * 100}%"></span></div>
            </div>`,
        )
        .join("")
    : '<p class="service-note">Service activity will appear after the first inquiry.</p>';
};

const filteredInquiries = () => {
  const query = $("#search-input").value.trim().toLowerCase();
  const service = $("#service-filter").value;
  return inquiryGroups(inquiries)[activeInquiryFilter].filter((item) => {
    const haystack = searchText(item.name, item.email, item.phone, eventServiceLabel(item.service), item.location,
      item.celebrationType, item.celebrationDate, formatDate(item.celebrationDate), item.status, item.message, item.notes);
    return matchesSearch(haystack, query) && (!service || eventServiceLabel(item.service) === service);
  });
};

const renderInquiries = () => {
  const filtered = filteredInquiries();
  $("#clear-inquiry-search").disabled = !$("#search-input").value;
  $("#inquiry-list-title").textContent = inquiryFilterTitles[activeInquiryFilter];
  document.querySelectorAll("[data-inquiry-filter]").forEach((button) => {
    const selected = button.dataset.inquiryFilter === activeInquiryFilter;
    button.classList.toggle("metric-featured", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("#result-count").textContent = `${filtered.length} of ${inquiries.length} inquiries`;
  emptyState.hidden = filtered.length > 0;
  inquiryList.hidden = filtered.length === 0;
  inquiryList.innerHTML = filtered.length
    ? `<div class="list-head"><span>Client</span><span>Service</span><span>Event date</span><span>Status</span></div>` +
      filtered
        .map(
          (item) => `
            <button class="inquiry-row" type="button" data-inquiry-id="${escapeHTML(item.id)}">
              <span class="client-cell"><strong>${escapeHTML(item.name || "Unnamed inquiry")}</strong><span>${escapeHTML(item.email || item.phone || "No contact supplied")}</span></span>
              <span class="service-cell"><strong>${escapeHTML(eventServiceLabel(item.service) || "Service not specified")}</strong><span>${escapeHTML(item.location || item.celebrationType || "Location pending")}</span></span>
              <span class="date-cell"><strong>${escapeHTML(formatDate(item.celebrationDate))}</strong><span>Received ${escapeHTML(formatDate(item.receivedAt, true))}</span></span>
              <span class="status-pill">${escapeHTML(item.status || "New")}</span>
            </button>`,
        )
        .join("")
    : "";
};

const detailFields = [
  ["Received", "receivedAt", true],
  ["Status", "status"],
  ["Priority", "priority"],
  ["Client email", "email"],
  ["Client phone", "phone"],
  ["Event date", "celebrationDate"],
  ["Second date", "secondDate"],
  ["Service", "service"],
  ["Event type", "celebrationType"],
  ["Location / address", "location"],
  ["Guest count", "guestCount"],
  ["Preferred contact", "contactMethod"],
  ["Service time", "serviceTime"],
  ["Parking fee", "parkingFee"],
  ["Referral source", "referralSource"],
  ["Referral detail", "sourceDetail"],
  ["Follow-up date", "followUpDate"],
  ["Owner", "owner"],
  ["Source", "source"],
  ["Submission ID", "id"],
];

const renderDetailGrid = (item) => {
  const hydrated = {
    ...item,
    serviceTime: [item.startTime, item.endTime].filter(Boolean).join(" – "),
  };
  $("#detail-grid").innerHTML = detailFields
    .filter(([, key]) => hydrated[key] !== "" && hydrated[key] !== null && hydrated[key] !== undefined)
    .map(([label, key, includeTime]) => {
      const value = key.toLowerCase().includes("date") || key === "receivedAt"
        ? formatDate(hydrated[key], includeTime)
        : hydrated[key];
      return `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`;
    })
    .join("");
};

const openInquiry = (id) => {
  const item = inquiries.find((inquiry) => inquiry.id === id);
  if (!item) return;
  activeInquiryId = item.id;
  $("#detail-name").textContent = item.name || "Unnamed inquiry";
  $("#detail-service").textContent = eventServiceLabel(item.service) || "Service not specified";
  $("#detail-actions").innerHTML = [
    item.email ? `<a href="mailto:${encodeURIComponent(item.email)}">Email client</a>` : "",
    item.phone ? `<a href="tel:${escapeHTML(item.phone.replace(/[^+\d]/g, ""))}">Call ${escapeHTML(item.phone)}</a>` : "",
  ].join("");
  renderDetailGrid(item);
  const note = $("#detail-note");
  note.hidden = !item.additionalInformation;
  note.querySelector("p").textContent = item.additionalInformation || "";
  const legacyStatus = $("#manage-legacy-status");
  const status = item.status || "New";
  legacyStatus.hidden = ["New", "Booked", "Closed"].includes(status);
  legacyStatus.textContent = legacyStatus.hidden ? "" : `Previous status: ${status} — choose a new status`;
  $("#manage-status").value = legacyStatus.hidden ? status : "";
  $("#manage-priority").value = item.priority || "Normal";
  $("#manage-follow-up").value = item.followUpDate || "";
  $("#manage-owner").value = item.owner || "";
  $("#manage-notes").value = item.internalNotes || "";
  setMessage($("#management-message"), "");
  const thread = messageThreads.find((candidate) => candidate.inquiryId === item.id);
  activeConversationUrl = thread?.clientUrl || "";
  $("#create-conversation-link").textContent = thread ? "Renew private link" : "Create private link";
  $("#copy-conversation-link").hidden = !thread;
  $("#open-conversation").hidden = !thread;
  setMessage($("#conversation-link-message"), thread
    ? "A secure client hub link is active for this inquiry."
    : "");
  dialog.showModal();
};

const saveInquiry = async (event) => {
  event.preventDefault();
  if (!activeInquiryId) return;
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage($("#management-message"), "Saving changes…");

  try {
    const response = await fetch("/api/hmp-dashboard", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: activeInquiryId,
        status: $("#manage-status").value,
        priority: $("#manage-priority").value,
        followUpDate: $("#manage-follow-up").value,
        owner: $("#manage-owner").value,
        internalNotes: $("#manage-notes").value,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Changes could not be saved.");

    inquiries = inquiries.map((item) => item.id === activeInquiryId ? data.inquiry : item);
    renderMetrics();
    renderServiceMix();
    renderInquiries();
    renderDetailGrid(data.inquiry);
    if (data.inquiry.status === "Booked") {
      let hubLoadFailed = false;
      try { await loadMessages(); } catch { hubLoadFailed = true; }
      const thread = messageThreads.find((item) => item.inquiryId === data.inquiry.id);
      activeConversationUrl = thread?.clientUrl || "";
      $("#create-conversation-link").textContent = thread ? "Renew private link" : "Create private link";
      $("#copy-conversation-link").hidden = !thread;
      $("#open-conversation").hidden = !thread;
      setMessage($("#conversation-link-message"), thread && !hubLoadFailed
        ? "Client hub is ready in Messages. Share the private link when ready; add Guest Seating there if included."
        : "Booking saved, but the client hub could not be loaded. Refresh Messages to check it.");
    }
    setMessage($("#management-message"), data.hubWarning || "Changes saved securely.", !data.hubWarning);
  } catch (error) {
    setMessage($("#management-message"), error.message || "Changes could not be saved.");
  } finally {
    button.disabled = false;
  }
};

const copyText = async (value) => {
  if (!value) throw new Error("No client link is available.");
  await navigator.clipboard.writeText(value);
};

const getMessageSignature = (messages = []) => JSON.stringify(messages.map((message) => [
  message.id,
  message.sender,
  message.body,
  message.createdAt,
  message.editedAt,
  message.emailNotifiedAt,
  message.emailNotificationError,
  message.document,
  (message.attachments || []).map((attachment) => [
    attachment.id,
    attachment.path,
    attachment.name,
    attachment.type,
    attachment.size,
  ]),
]));

const renderAdminMessages = (thread) => {
  const allMessages = thread.messages || [];
  const signature = `${activeHubSection}:${getMessageSignature(allMessages)}`;
  if (thread.id === renderedAdminThreadId && signature === renderedAdminMessageSignature) return;
  renderedAdminThreadId = thread.id;
  renderedAdminMessageSignature = signature;
  const focusedTab = document.activeElement?.classList?.contains("hub-tab")
    ? [...$("#admin-hub-tabs").children].indexOf(document.activeElement) : -1;
  renderHubTabs($("#admin-hub-tabs"), allMessages, activeHubSection, (section) => {
    activeHubSection = section;
    renderAdminMessages(thread);
  });
  if (focusedTab >= 0) $("#admin-hub-tabs").children[focusedTab]?.focus();
  const visible = hubMessages(allMessages, activeHubSection);
  const list = $("#admin-message-list");
  list.replaceChildren();
  visible.forEach((message) => {
    const article = document.createElement("article");
    article.className = `admin-message ${message.sender === "admin" ? "admin" : "client"}`;
    const meta = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = message.sender === "admin" ? "HMP representative" : thread.clientName;
    const time = document.createElement("time");
    time.dateTime = message.createdAt;
    time.textContent = formatDate(message.createdAt, true);
    meta.append(name, time);
    if (message.editedAt) {
      const edited = document.createElement("span");
      edited.textContent = "Edited";
      edited.title = `Edited ${formatDate(message.editedAt, true)}`;
      meta.append(edited);
    }
    const proposal = parseProposal(message.body);
    const copy = document.createElement("p");
    if (message.sender === "admin") appendLinkedText(copy, message.body);
    else copy.textContent = message.body;
    article.append(meta);
    const documentCard=message.sender === "admin" ? renderDocumentCard(message.document) : null;
    if (documentCard) { article.classList.add("document-message"); article.append(documentCard); }
    else if (proposal) {
      article.classList.add("proposal-message");
      article.append(renderProposalPreview(proposal));
    } else if (message.body) article.append(copy);
    appendAttachments(article, message.attachments);
    if (message.sender === "admin") {
      const actions = document.createElement("div");
      actions.className = "admin-message-actions";
      if (message.body && !proposal && !message.document) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Edit";
        edit.setAttribute("aria-label", `Edit message sent ${formatDate(message.createdAt, true)}`);
        edit.addEventListener("click", () => showAdminMessageEditor(article, thread.id, message));
        actions.append(edit);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", `Delete message sent ${formatDate(message.createdAt, true)}`);
      remove.addEventListener("click", () => deleteAdminMessage(thread.id, message.id));
      actions.append(remove);
      article.append(actions);
    }
    if (message.sender === "admin" && (message.emailNotifiedAt || message.emailNotificationError)) {
      const status=document.createElement("p");
      status.className="message-email-status";
      status.textContent=message.emailNotifiedAt ? "Email notification sent" : `Email not confirmed: ${message.emailNotificationError}`;
      article.append(status);
      if (!message.emailNotifiedAt) {
        const retry=document.createElement("button");
        retry.type="button"; retry.className="message-email-retry";
        retry.textContent="Retry email notification";
        retry.addEventListener("click",()=>retryMessageNotification(thread.id,message.id,retry));
        article.append(retry);
      }
    }
    list.append(article);
  });
  $("#admin-message-empty").textContent = activeHubSection === "all" ? "No messages yet. Send a welcome note to begin the conversation." : `No ${activeHubSection} in this event hub yet.`;
  $("#admin-message-empty").hidden = visible.length > 0;
  list.hidden = visible.length === 0;
  if (!list.hidden) list.scrollTop = list.scrollHeight;
};

const changeAdminMessage = async (action, conversationId, messageId, message) => {
  const response = await fetch("/api/hmp-messages", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, conversationId, messageId, message }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Message could not be changed.");
  await loadMessages();
  setMessage($("#admin-message-status"), action === "edit-message" ? "Message updated." : "Message deleted from both portals.", true);
};

const showAdminMessageEditor = (article, conversationId, message) => {
  if (article.querySelector(".admin-message-editor")) return;
  const editor = document.createElement("form");
  editor.className = "admin-message-editor";
  const input = document.createElement("textarea");
  input.value = message.body;
  input.maxLength = 4000;
  input.required = true;
  input.setAttribute("aria-label", "Edit message text");
  const controls = document.createElement("div");
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save changes";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => editor.remove());
  controls.append(save, cancel);
  editor.append(input, controls);
  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input.value.trim()) return;
    save.disabled = true;
    try { await changeAdminMessage("edit-message", conversationId, message.id, input.value); }
    catch (error) { setMessage($("#admin-message-status"), error.message); save.disabled = false; }
  });
  article.append(editor);
  input.focus();
};

const deleteAdminMessage = async (conversationId, messageId) => {
  if (!window.confirm("Delete this message from the Admin and Client portals? This will not recall an email already delivered.")) return;
  try { await changeAdminMessage("delete-message", conversationId, messageId); }
  catch (error) { setMessage($("#admin-message-status"), error.message); }
};

const proposalFormFields = {
  title: "#proposal-title",
  clientName: "#proposal-client-name",
  celebrationType: "#proposal-celebration-type",
  eventDate: "#proposal-event-date",
  eventTime: "#proposal-event-time",
  eventLocation: "#proposal-event-location",
  guestCount: "#proposal-guest-count",
  serviceHours: "#proposal-service-hours",
  associates: "#proposal-associates",
  machines: "#proposal-machines",
  serviceDetails: "#proposal-service-details",
  notes: "#proposal-notes",
  additionalInformation: "#proposal-additional-information",
  serviceFee: "#proposal-service-fee",
  validUntil: "#proposal-valid-until",
  paymentTerms: "#proposal-payment-terms",
  calendarUrl: "#proposal-calendar-url",
};

const proposalPayload = () => ({
  ...Object.fromEntries(Object.entries(proposalFormFields).map(([key, selector]) => [key, $(selector).value])),
  lineageId: activeProposalLineageId,
  version: activeProposalVersion,
});

const validProposalServiceHours = () => {
  const input = $("#proposal-service-hours");
  const value = input.value.trim();
  const hours = Number(value);
  const valid = !value || /^n\/?a$/i.test(value)
    || (/^\d+(?:\.[05])?$/.test(value) && hours <= 240);
  input.setCustomValidity(valid ? "" : "Enter 0–240 hours in half-hour increments, or N/A.");
  return valid;
};

const proposalDirtyState = createProposalDirtyState({
  read: proposalPayload,
  isOpen: () => $("#proposal-editor-dialog").open,
});

const closeProposalEditor = ({ confirmDiscard = true } = {}) => {
  if (confirmDiscard && proposalDirtyState.isDirty()
    && !window.confirm("Discard your unsaved proposal changes?")) return false;
  proposalDirtyState.reset();
  activeProposalDraftId = "";
  $("#proposal-editor-dialog").close();
  return true;
};

const openProposalEditor = () => {
  const thread = messageThreads.find((candidate) => candidate.id === activeThreadId);
  if (!thread) return;
  activeProposalDraftId = "";
  activeProposalLineageId = crypto.randomUUID();
  activeProposalVersion = 1;
  const inquiry = inquiries.find((candidate) => candidate.id === thread.inquiryId) || {};
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 14);
  const values = {
    title: "Money Changing Service Only",
    clientName: thread.clientName,
    celebrationType: proposalEventType(inquiry.celebrationType || eventServiceLabel(thread.service)),
    eventDate: inquiry.celebrationDate || thread.celebrationDate || "",
    eventTime: [inquiry.startTime, inquiry.endTime].filter(Boolean).join(" – "),
    eventLocation: inquiry.location || "",
    guestCount: inquiry.guestCount || "",
    serviceHours: 4,
    associates: 3,
    machines: 3,
    serviceDetails: "",
    notes: "",
    additionalInformation: "",
    serviceFee: 900,
    validUntil: localDateValue(validUntil),
    paymentTerms: "",
    calendarUrl: "",
  };
  Object.entries(proposalFormFields).forEach(([key, selector]) => {
    $(selector).value = values[key] ?? "";
  });
  setMessage($("#proposal-editor-message"), "");
  $("#proposal-editor-dialog .dialog-heading > div > p:last-child").textContent = "Adjust the details, then send this version securely to your client.";
  proposalDirtyState.begin();
  $("#proposal-editor-dialog").showModal();
};

const openProposalRevision = (selected, versions) => {
  activeThreadId = selected.thread.id;
  openProposalEditor();
  activeProposalLineageId = selected.proposal.lineageId || selected.message.id;
  activeProposalVersion = Math.max(...versions.map(({ proposal }) => proposal.version)) + 1;
  Object.entries(proposalFormFields).forEach(([key, selector]) => {
    $(selector).value = selected.proposal[key] ?? "";
  });
  $("#proposal-editor-dialog .dialog-heading > div > p:last-child").textContent = `Version ${activeProposalVersion} will replace the current proposal in the Admin list. Earlier sent versions stay in its history.`;
  proposalDirtyState.begin();
};

const openProposalDraft = (draft) => {
  if (!draft) return;
  if (!messageThreads.some((thread) => thread.id === draft.conversationId)) {
    setMessage($("#drafts-status"), "This proposal's client conversation is unavailable. Open or create a client conversation first.");
    return;
  }
  activeThreadId = draft.conversationId;
  openProposalEditor();
  activeProposalDraftId = draft.id;
  activeProposalLineageId = draft.payload?.lineageId || crypto.randomUUID();
  activeProposalVersion = draft.payload?.version || 1;
  Object.entries(proposalFormFields).forEach(([key, selector]) => { $(selector).value = draft.payload?.[key] ?? ""; });
  proposalDirtyState.begin();
};

const saveProposalDraft = async () => {
  if (!activeThreadId) return;
  if (!validProposalServiceHours()) { $("#proposal-service-hours").reportValidity(); return; }
  const payload = proposalPayload();
  if (payload.calendarUrl && !normalizeCalendarUrl(payload.calendarUrl)) {
    setMessage($("#proposal-editor-message"), "Enter a valid https:// calendar link.");
    return;
  }
  const button = $("#save-proposal-draft");
  button.disabled = true;
  setMessage($("#proposal-editor-message"), "Saving draft…");
  try {
    const response = await fetch("/api/hmp-proposal-drafts", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", id: activeProposalDraftId || undefined, conversationId: activeThreadId, payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Proposal draft could not be saved.");
    activeProposalDraftId = data.draft.id;
    proposalDrafts = [data.draft, ...proposalDrafts.filter((draft) => draft.id !== data.draft.id)];
    if (activeWorkspaceView === "drafts") renderCurrentDrafts();
    proposalDirtyState.markSaved(payload);
    setMessage($("#proposal-editor-message"), "Proposal draft saved privately. Find it under Drafts → Proposals.", true);
  } catch (error) { setMessage($("#proposal-editor-message"), error.message || "Proposal draft could not be saved."); }
  finally { button.disabled = false; }
};

const createProposalFromWorkspace = () => {
  if (!activeThreadId) {
    openManualInquiry();
    return;
  }
  openProposalEditor();
};

let manualInquiryId = "";
let manualInquirySaved = null;
const openManualInquiry = () => {
  manualInquiryId = crypto.randomUUID();
  manualInquirySaved = null;
  $("#manual-inquiry-form").reset();
  setMessage($("#manual-inquiry-message"), "");
  $("#manual-inquiry-dialog").showModal();
};

const createManualInquiry = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const wantsProposal = event.submitter?.value === "proposal";
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  setMessage($("#manual-inquiry-message"), "Saving inquiry…");
  try {
    if (!manualInquirySaved) {
      const response = await fetch("/api/hmp-dashboard", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), id: manualInquiryId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Inquiry could not be saved.");
      manualInquirySaved = data.inquiry;
    }
    const inquiry = manualInquirySaved;
    inquiries = [inquiry, ...inquiries.filter((item) => item.id !== inquiry.id)];
    renderMetrics(); renderServiceFilter(); renderServiceMix(); renderInquiries();
    if (wantsProposal) {
      const response = await fetch("/api/hmp-messages", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-link", inquiryId: inquiry.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Inquiry saved. Could not open the proposal; please retry.");
      await loadMessages();
      setWorkspaceView("messages", true);
      openMessageThread(data.conversationId);
      $("#manual-inquiry-dialog").close();
      openProposalEditor();
    } else {
      $("#manual-inquiry-dialog").close();
      setWorkspaceView("inquiries", true);
      openInquiry(inquiry.id);
    }
  } catch (error) {
    setMessage($("#manual-inquiry-message"), error.message || "Inquiry could not be saved.");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
};

const sendProposal = async (event) => {
  event.preventDefault();
  validProposalServiceHours();
  if (!activeThreadId || !event.currentTarget.reportValidity()) return;
  const conversationId = activeThreadId;
  const proposal = proposalPayload();
  if (proposal.calendarUrl && !normalizeCalendarUrl(proposal.calendarUrl)) {
    setMessage($("#proposal-editor-message"), "Enter a valid https:// calendar link.");
    return;
  }
  const message = serializeProposal(proposal);
  if (message.length > 4000) {
    setMessage($("#proposal-editor-message"), "Shorten the service details or notes before sending.");
    return;
  }
  const buttons = event.currentTarget.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  setMessage($("#proposal-editor-message"), "Sending proposal securely…");
  try {
    const response = await fetch("/api/hmp-messages", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send",
        conversationId,
        message,
        requestId: crypto.randomUUID(),
        attachments: [],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Proposal could not be sent.");
    const sentDraftId = activeProposalDraftId;
    closeProposalEditor({ confirmDiscard: false });
    showMessageNotificationStatus(data,"Proposal");
    const postSendWarnings = [];
    if (sentDraftId) {
      try {
        const draftResponse = await fetch("/api/hmp-proposal-drafts", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark-sent", id: sentDraftId, conversationId, messageId: data.message.id }),
        });
        if (draftResponse.ok) proposalDrafts = proposalDrafts.filter((draft) => draft.id !== sentDraftId);
        else postSendWarnings.push("The saved draft could not be cleared; refresh before using it again.");
      } catch {
        postSendWarnings.push("The saved draft could not be cleared; refresh before using it again.");
      }
    }
    await loadMessages().catch(() => {
      postSendWarnings.push("Latest messages could not be refreshed; reload to see the sent proposal.");
    });
    if (postSendWarnings.length) {
      const warning = `${$("#admin-message-status").textContent} ${postSendWarnings.join(" ")}`.trim();
      setMessage($("#admin-message-status"), warning);
      setMessage($("#proposal-workspace-status"), warning);
      if (activeWorkspaceView === "drafts") setMessage($("#drafts-status"), warning);
    }
    if (activeWorkspaceView === "drafts") renderCurrentDrafts();
  } catch (error) {
    setMessage($("#proposal-editor-message"), error.message || "Proposal could not be sent.");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
};

const loadHubForms = async (thread) => {
  const select = $("#hub-form-select");
  select.dataset.threadId = thread.id;
  select.replaceChildren(new Option("Loading client forms…", ""));
  $("#hub-share-form").disabled = true;
  setMessage($("#hub-form-status"), "");
  try {
    const response = await fetch("/api/hmp-agreement-forms", {credentials:"same-origin",cache:"no-store"});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Client forms could not be loaded.");
    if (activeThreadId !== thread.id) return;
    const shared = new Set((thread.messages || []).filter((message) => message.document?.kind === "form").map((message) => message.document.id));
    availableHubForms = (data.agreements || []).filter((form) =>
      String(form.client_email || "").trim().toLowerCase() === String(thread.clientEmail || "").trim().toLowerCase()
      && ["Sent", "Completed"].includes(form.status) && Date.parse(form.expires_at) > Date.now() && !shared.has(form.id));
    select.replaceChildren(new Option(availableHubForms.length ? "Choose a form for this event" : "No unshared sent forms for this client", ""));
    for (const form of availableHubForms) {
      const title = form.snapshot?.title || form.template_id || "Client form";
      const event = form.admin_answers?.eventName || form.admin_answers?.event_name || "";
      select.add(new Option(`${title}${event ? ` · ${event}` : ""} · ${form.status}`, form.id));
    }
  } catch (error) {
    if (activeThreadId !== thread.id) return;
    select.replaceChildren(new Option("Forms unavailable", ""));
    setMessage($("#hub-form-status"), error.message || "Client forms could not be loaded.");
  }
};

const shareHubForm = async () => {
  const form = availableHubForms.find((item) => item.id === $("#hub-form-select").value);
  const thread = messageThreads.find((item) => item.id === activeThreadId);
  if (!form || !thread) return;
  const title = form.snapshot?.title || form.template_id || "Client form";
  if (!window.confirm(`Add “${title}” to ${thread.clientName}'s ${thread.service} hub? Check that this form belongs to this event.`)) return;
  const button = $("#hub-share-form");
  button.disabled = true;
  try {
    const response = await fetch("/api/hmp-messages", {method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"share-form",conversationId:thread.id,formId:form.id})});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Form could not be added.");
    $("#hub-form-select").dataset.threadId = "";
    await loadMessages();
    setMessage($("#hub-form-status"), data.alreadyShared ? "This form is already in the hub." : "Form added to this event hub. Send the client link if needed.", true);
  } catch (error) {
    setMessage($("#hub-form-status"), error.message || "Form could not be added.");
  } finally {
    button.disabled = !$("#hub-form-select").value;
  }
};

const shareHubSeating = async (event) => {
  event.preventDefault();
  const thread = messageThreads.find((item) => item.id === activeThreadId);
  const form = event.currentTarget;
  const url = $("#hub-seating-url").value.trim();
  if (!thread || !form.reportValidity()) return;
  if (!window.confirm(`Add this private Guest Seating link to ${thread.clientName}'s ${thread.service} hub? Check that the event and client match.`)) return;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage($("#hub-seating-status"), "Checking the event…");
  try {
    const response = await fetch("/api/hmp-messages", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "share-seating", conversationId: thread.id, url }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Guest Seating could not be added.");
    if (activeThreadId === thread.id) {
      $("#hub-seating-url").value = "";
      activeHubSection = "seating";
    }
    await loadMessages();
    if (activeThreadId === thread.id)
      setMessage($("#hub-seating-status"), data.alreadyShared ? "This Guest Seating link is already in the hub." : `${data.eventName} added to this client hub.`, true);
  } catch (error) {
    if (activeThreadId === thread.id) setMessage($("#hub-seating-status"), error.message || "Guest Seating could not be added.");
  } finally {
    button.disabled = false;
  }
};

const openMessageThread = (threadId) => {
  const thread = messageThreads.find((candidate) => candidate.id === threadId);
  if (!thread) return;
  if (threadId !== activeThreadId) {
    const attachmentInput = $("#admin-message-attachments");
    if (attachmentInput.disabled) return;
    if ((pendingFiles(attachmentInput).length || $("#admin-message-input").value.trim())
      && !window.confirm("Discard your unsent reply and attachments before opening another conversation?")) return;
    activeHubSection = "messages";
    clearStagedAttachments(attachmentInput);
    $("#admin-message-input").value = "";
    renderAttachmentPreviews(attachmentInput, $("#admin-message-attachment-previews"), $("#admin-message-attachment-summary"));
  }
  activeThreadId = thread.id;
  activeConversationUrl = thread.clientUrl;
  $("#admin-conversation-placeholder").hidden = true;
  $("#admin-conversation").hidden = false;
  $("#admin-conversation-name").textContent = thread.clientName;
  $("#admin-conversation-email").textContent = thread.clientEmail;
  $("#admin-conversation-service").textContent = eventServiceLabel(thread.service);
  $("#copy-active-link").textContent = thread.active ? "Copy client link" : "Link expired";
  $("#copy-active-link").disabled = !thread.active;
  setMessage($("#admin-message-status"), "");
  $("#hub-seating-url").value = "";
  setMessage($("#hub-seating-status"), "");
  renderAdminMessages(thread);
  if (threadId !== $("#hub-form-select").dataset.threadId) loadHubForms(thread);
  document.querySelectorAll("[data-thread-id]").forEach((button) => {
    button.classList.toggle("active", button.dataset.threadId === threadId);
  });
};

const renderMessageThreads = () => {
  const list = $("#thread-list");
  list.replaceChildren();
  $("#thread-count").textContent = messageThreads.length;
  $("#thread-empty").hidden = messageThreads.length > 0;
  list.hidden = messageThreads.length === 0;
  messageThreads.forEach((thread) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thread-row";
    button.dataset.threadId = thread.id;
    button.dataset.searchText = searchText(thread.clientName, thread.clientEmail, thread.service,
      (thread.messages || []).map(message => [message.body, message.createdAt,
        (message.attachments || []).map(file => file.name), message.document?.number,
        message.document?.event_name, message.document?.notes]));
    if (thread.id === activeThreadId) button.classList.add("active");
    const top = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = thread.clientName;
    const date = document.createElement("time");
    date.textContent = thread.lastMessageAt ? formatDate(thread.lastMessageAt, true) : "New link";
    top.append(name, date);
    const service = document.createElement("small");
    service.textContent = eventServiceLabel(thread.service);
    const status = document.createElement("em");
    status.textContent = thread.lastSender === "client" ? "New client reply" : thread.active ? "Private link active" : "Link expired";
    button.append(top, service, status);
    list.append(button);
  });
};

const renderClientActivity = () => {
  const clients = $("#activity-clients");
  clients.replaceChildren();
  if (!messageThreads.some((thread) => thread.id === activeActivityThreadId)) {
    activeActivityThreadId = messageThreads[0]?.id || "";
  }
  for (const thread of messageThreads) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "activity-client";
    button.dataset.searchText = searchText(thread.clientName, thread.clientEmail, thread.service, thread.celebrationDate);
    button.setAttribute("aria-pressed", String(thread.id === activeActivityThreadId));
    const name = document.createElement("strong");
    name.textContent = thread.clientName;
    const service = document.createElement("small");
    service.textContent = eventServiceLabel(thread.service);
    button.append(name, service);
    button.addEventListener("click", () => {
      activeActivityThreadId = thread.id;
      renderClientActivity();
      void loadSeatingActivityForThread(thread);
    });
    clients.append(button);
  }
  const thread = messageThreads.find((item) => item.id === activeActivityThreadId);
  $("#activity-client-title").textContent = thread?.clientName || "No client hubs yet";
  $("#activity-client-event").textContent = thread
    ? `${eventServiceLabel(thread.service)} · ${formatDate(thread.celebrationDate)}` : "";
  $("#activity-open-hub").hidden = !thread;
  const timeline = $("#activity-timeline");
  timeline.replaceChildren();
  const items = clientActivityItems(thread, activityFormsById, activitySeatingByThreadId.get(thread?.id) || []);
  for (const item of items) {
    const row = document.createElement("li");
    const date = document.createElement("time");
    date.dateTime = item.at || "";
    date.textContent = formatDate(item.at, true);
    const title = document.createElement("strong");
    title.textContent = item.title;
    const detail = document.createElement("span");
    detail.textContent = item.detail;
    row.append(date, title, detail);
    timeline.append(row);
  }
  $("#activity-empty").hidden = items.length > 0;
  $("#activity-empty").textContent = thread
    ? "No shared documents or client activity for this event yet." : "Create a client hub from an inquiry to see its activity here.";
};

const loadSeatingActivityForThread = async (thread) => {
  const requestId = ++activitySeatingRequest;
  if (!thread) return;
  const hasSeating = thread?.messages?.some((message) => message.sender === "admin" && message.document?.kind === "seating");
  if (!hasSeating) {
    if (activitySeatingByThreadId.delete(thread.id)) renderClientActivity();
    setMessage($("#activity-seating-status"), "");
    return;
  }
  setMessage($("#activity-seating-status"), "Loading Guest Seating activity…");
  try {
    const response = await fetch("/api/hmp-messages", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "seating-activity", conversationId: thread.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Guest Seating activity is unavailable.");
    const titles = {
      sign_in: "Guest Seating client signed in", pin_setup: "Guest Seating PIN created",
      guest_added: "Guest added", guest_updated: "Guest updated", guest_deleted: "Guest deleted",
      guest_list_uploaded: "Guest list uploaded", guest_list_removed: "Guest list removed",
    };
    activitySeatingByThreadId.set(thread.id, (data.activity || []).map((item) => ({
      id: item.id, at: item.at, title: titles[item.kind] || "Guest Seating activity", detail: item.detail,
    })));
    if (requestId === activitySeatingRequest && activeActivityThreadId === thread.id) {
      setMessage($("#activity-seating-status"), "");
      renderClientActivity();
    }
  } catch (error) {
    activitySeatingByThreadId.delete(thread.id);
    if (requestId === activitySeatingRequest && activeActivityThreadId === thread.id) {
      setMessage($("#activity-seating-status"), error.message || "Guest Seating activity is unavailable.");
      renderClientActivity();
    }
  }
};

const loadMessages = async () => {
  const response = await fetch("/api/hmp-messages", { credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Messages are unavailable.");
  messageThreads = data.threads || [];
  renderMessageThreads();
  if (activeWorkspaceView === "activity") renderClientActivity();
  renderProposalsWorkspace(messageThreads, (threadId) => {
    openMessageThread(threadId);
    if (activeThreadId === threadId) setWorkspaceView("messages", true);
  }, openProposalRevision);
  if (activeThreadId && messageThreads.some((thread) => thread.id === activeThreadId)) {
    openMessageThread(activeThreadId);
  }
};

const loadClientActivity = async () => {
  setMessage($("#activity-status"), "Loading client activity…");
  await loadMessages();
  try {
    const response = await fetch("/api/hmp-agreement-forms", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Form statuses are unavailable.");
    activityFormsById = new Map((data.agreements || []).map((form) => [form.id, form]));
    setMessage($("#activity-status"), "");
  } catch {
    activityFormsById = new Map();
    setMessage($("#activity-status"), "Shared documents are shown, but completed-form statuses could not be refreshed.");
  }
  renderClientActivity();
  const selected = messageThreads.find((thread) => thread.id === activeActivityThreadId);
  if (selected) await loadSeatingActivityForThread(selected);
};

$("#activity-open-hub").addEventListener("click", () => {
  if (!activeActivityThreadId) return;
  openMessageThread(activeActivityThreadId);
  if (activeThreadId === activeActivityThreadId) setWorkspaceView("messages", true);
});

const loadMessageSignature = () => {
  if (messageSignatureLoaded) return Promise.resolve();
  if (messageSignatureLoadPromise) return messageSignatureLoadPromise;
  messageSignatureLoadPromise = (async () => {
    const response = await fetch("/api/hmp-message-signature", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Message signature could not be loaded.");
    messageSignature = data.signature || "";
    messageSignatureLoaded = true;
    $("#message-signature-input").value = messageSignature;
    $("#message-signature-input").disabled = false;
    $("#message-signature-form button[type=submit]").disabled = false;
    $("#insert-message-signature").disabled = !messageSignature;
    setMessage($("#message-signature-status"), "");
  })().finally(() => { messageSignatureLoadPromise = null; });
  return messageSignatureLoadPromise;
};

const selectMessageTab = (tab) => {
  const signatureTab = tab === "signature";
  const input = $("#message-signature-input");
  if (!signatureTab && input.value !== messageSignature && !window.confirm("Discard your unsaved signature changes?")) return;
  if (!signatureTab) input.value = messageSignature;
  $("#message-signature-tab").setAttribute("aria-selected", String(signatureTab));
  $("#message-conversations-tab").setAttribute("aria-selected", String(!signatureTab));
  $("#message-signature-panel").hidden = !signatureTab;
  $("#message-conversations-panel").hidden = signatureTab;
  if (signatureTab) loadMessageSignature().catch((error) => setMessage($("#message-signature-status"), error.message));
};

const saveMessageSignature = async (event) => {
  event.preventDefault();
  const input = $("#message-signature-input");
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage($("#message-signature-status"), "Saving signature…");
  try {
    const response = await fetch("/api/hmp-message-signature", {
      method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature: input.value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Message signature could not be saved.");
    messageSignature = data.signature;
    input.value = messageSignature;
    $("#insert-message-signature").disabled = !messageSignature;
    setMessage($("#message-signature-status"), messageSignature ? "Signature saved for the HMP team. Insert it into any reply when needed." : "Signature cleared.", true);
  } catch (error) {
    setMessage($("#message-signature-status"), error.message || "Message signature could not be saved.");
  } finally { button.disabled = false; }
};

const createConversationLink = async () => {
  if (!activeInquiryId) return;
  if (messageThreads.some((thread) => thread.inquiryId === activeInquiryId) && !window.confirm("Renew this private link? The old link, PIN, and client sessions will stop working. Share the new link so the client can create a new PIN.")) return;
  const button = $("#create-conversation-link");
  button.disabled = true;
  setMessage($("#conversation-link-message"), "Creating a secure private link…");
  try {
    const response = await fetch("/api/hmp-messages", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-link", inquiryId: activeInquiryId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Private link could not be created.");
    activeConversationUrl = data.clientUrl;
    $("#copy-conversation-link").hidden = false;
    $("#open-conversation").hidden = false;
    button.textContent = "Renew private link";
    await copyText(activeConversationUrl);
    await loadMessages();
    setMessage($("#conversation-link-message"), "Secure link created and copied. Send it only to this client.", true);
  } catch (error) {
    setMessage($("#conversation-link-message"), error.message || "Private link could not be created.");
  } finally {
    button.disabled = false;
  }
};

const sendNewConversationLink = async (inquiryId, statusElement, resetPin = false) => {
  const inquiry = inquiries.find((candidate) => candidate.id === inquiryId);
  const thread = messageThreads.find((candidate) => candidate.inquiryId === inquiryId);
  const clientName = inquiry?.name || thread?.clientName || "this client";
  const clientEmail = inquiry?.email || thread?.clientEmail || "";
  if (!clientEmail) {
    setMessage(statusElement, "Add a client email before sending a new link.");
    return;
  }
  if (!window.confirm(`${resetPin ? "Reset the client PIN and send" : "Send"} a new private conversation link to ${clientName} at ${clientEmail}? The previous link and sessions will stop working. The client will choose a new PIN. Messages will not be deleted.`)) return;

  const buttons = document.querySelectorAll("#send-new-conversation-link, #send-new-active-link, #reset-client-pin");
  buttons.forEach((button) => { button.disabled = true; });
  setMessage(statusElement, "Creating and emailing a new private link…");
  try {
    const response = await fetch("/api/hmp-messages", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: resetPin ? "reset-pin" : "send-link", inquiryId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "New link could not be created.");
    activeConversationUrl = data.clientUrl;
    await loadMessages();
    $("#copy-conversation-link").hidden = false;
    $("#open-conversation").hidden = false;
    $("#create-conversation-link").textContent = "Renew private link";
    if (data.emailed) {
      setMessage(statusElement, `A new private link was emailed to ${clientEmail}. The client can create a new PIN when they open it.`, true);
    } else {
      setMessage(statusElement, "The new link was created, but email delivery failed. Copy the link and send it manually.");
    }
  } catch (error) {
    setMessage(statusElement, error.message || "New link could not be sent.");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
};

const showMessageNotificationStatus = (data, label = "Reply") => {
  const status=data.notified
    ? `${label} saved in the portal and email notification sent.`
    : `${label} saved in the portal, but email was not confirmed. ${data.notificationError || "Use Retry email notification on the message."}`;
  setMessage($("#admin-message-status"), `${status}${data.notificationWarning ? ` ${data.notificationWarning}` : ""}`, data.notified && !data.notificationWarning);
  if (activeWorkspaceView === "proposals") {
    setMessage($("#proposal-workspace-status"), `${status}${data.notificationWarning ? ` ${data.notificationWarning}` : ""}`, data.notified && !data.notificationWarning);
  }
};

const retryMessageNotification = async (conversationId, messageId, button) => {
  button.disabled=true;
  button.textContent="Retrying email…";
  try {
    const response=await fetch("/api/hmp-messages",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"retry-notification",conversationId,messageId})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error || "Email notification could not be retried.");
    await loadMessages();
    if(activeThreadId===conversationId)showMessageNotificationStatus(data,"Message");
  } catch(error) {
    if(activeThreadId===conversationId)setMessage($("#admin-message-status"),error.message);
  } finally {button.disabled=false;button.textContent="Retry email notification";}
};

const sendAdminMessage = async (event) => {
  event.preventDefault();
  if (!activeThreadId || $("#admin-message-attachments").disabled) return;
  const input = $("#admin-message-input");
  const message = input.value.trim();
  const attachmentInput = $("#admin-message-attachments");
  let files;
  try {
    files = selectedFiles(attachmentInput);
  } catch (error) {
    setMessage($("#admin-message-status"), error.message);
    return;
  }
  if (!message && !files.length) return;
  const requestId = globalThis.crypto.randomUUID();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  input.readOnly = true;
  setAttachmentBusy(attachmentInput, $("#admin-message-attachment-previews"), true);
  setMessage($("#admin-message-status"), files.length ? "Uploading attachments…" : "Sending reply…");
  try {
    const attachments = await uploadAttachments({
      files,
      messageId: requestId,
      prepare: async (payload) => {
        const response = await fetch("/api/hmp-messages", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, conversationId: activeThreadId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Attachment could not be uploaded.");
        return data;
      },
    });
    setMessage($("#admin-message-status"), "Sending reply…");
    const response = await fetch("/api/hmp-messages", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", conversationId: activeThreadId, message, requestId, attachments }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Reply could not be sent.");
    input.value = "";
    clearStagedAttachments(attachmentInput);
    updateAttachmentSummary(attachmentInput, $("#admin-message-attachment-summary"));
    renderAttachmentPreviews(attachmentInput, $("#admin-message-attachment-previews"), $("#admin-message-attachment-summary"));
    await loadMessages();
    showMessageNotificationStatus(data);
  } catch (error) {
    setMessage($("#admin-message-status"), error.message || "Reply could not be sent.");
  } finally {
    button.disabled = false;
    input.readOnly = false;
    setAttachmentBusy(attachmentInput, $("#admin-message-attachment-previews"), false);
  }
};

const deleteActiveConversation = async () => {
  const thread = messageThreads.find((candidate) => candidate.id === activeThreadId);
  if (!thread) return;
  if (!window.confirm(`Permanently delete the conversation with ${thread.clientName}? All messages, proposals, and attachments in this conversation will be removed, and the client link will stop working.`)) return;
  const button = $("#delete-active-conversation");
  button.disabled = true;
  setMessage($("#admin-message-status"), "Deleting conversation…");
  try {
    const response = await fetch("/api/hmp-messages", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", conversationId: thread.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Conversation could not be deleted.");
    messageThreads = messageThreads.filter((candidate) => candidate.id !== thread.id);
    activeThreadId = "";
    activeConversationUrl = "";
    $("#admin-conversation").hidden = true;
    $("#admin-conversation-placeholder").hidden = false;
    renderMessageThreads();
    await loadMessages();
  } catch (error) {
    setMessage($("#admin-message-status"), error.message || "Conversation could not be deleted.");
  } finally {
    button.disabled = false;
  }
};

const formatMoney = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value) || 0,
  );

const localDateValue = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const invoiceDueDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return localDateValue(date);
};

const resizeInvoiceTextareas = () => {
  if (!$("#invoice-editor-dialog").open) return;
  document.querySelectorAll("#invoice-sheet textarea").forEach((field) => {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight + 2}px`;
  });
};

const renderInvoiceItems = () => {
  $("#invoice-items").innerHTML = invoiceItems
    .map(
      (item) => `
        <div class="invoice-item-row" data-line-item="${escapeHTML(item.id)}">
          <textarea data-item-field="description" rows="3" maxlength="500" placeholder="Guest Seating Experience&#10;Add service details on a new line" aria-label="Service description" required>${escapeHTML(item.description)}</textarea>
          <input data-item-field="quantity" type="number" min="0.01" step="0.01" value="${escapeHTML(item.quantity)}" aria-label="Quantity" required />
          <input data-item-field="rate" type="number" min="0" step="0.01" value="${escapeHTML(item.rate)}" aria-label="Rate" required />
          <span class="invoice-item-amount">${formatMoney(Number(item.quantity) * Number(item.rate))}</span>
          <button class="remove-line-item" type="button" aria-label="Remove line item">×</button>
        </div>`,
    )
    .join("");
  calculateInvoiceTotals();
  resizeInvoiceTextareas();
};

const calculateInvoiceTotals = () => {
  const subtotal = invoiceItems.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0),
    0,
  );
  const discount = Math.min(subtotal, Math.max(0, Number($("#invoice-discount").value) || 0));
  const taxRate = Math.min(100, Math.max(0, Number($("#invoice-tax-rate").value) || 0));
  const taxAmount = (subtotal - discount) * (taxRate / 100);
  const total = subtotal - discount + taxAmount;
  $("#invoice-subtotal").textContent = formatMoney(subtotal);
  $("#invoice-tax-amount").textContent = formatMoney(taxAmount);
  $("#invoice-total").textContent = formatMoney(total);
  document.querySelectorAll(".invoice-item-row").forEach((row) => {
    const item = invoiceItems.find((candidate) => candidate.id === row.dataset.lineItem);
    if (item) row.querySelector(".invoice-item-amount").textContent = formatMoney(Number(item.quantity) * Number(item.rate));
  });
};

const addInvoiceItem = (item = {}) => {
  invoiceItems.push({
    id: item.id || crypto.randomUUID(),
    description: item.description || "",
    quantity: item.quantity ?? 1,
    rate: item.rate ?? 0,
  });
  renderInvoiceItems();
  $('#invoice-items .invoice-item-row:last-child [data-item-field="description"]').focus();
};

const invoiceFormFields = {
  status: "#invoice-status",
  clientName: "#invoice-client-name",
  clientEmail: "#invoice-client-email",
  clientPhone: "#invoice-client-phone",
  eventAddress: "#invoice-event-address",
  issueDate: "#invoice-issue-date",
  dueDate: "#invoice-due-date",
  eventName: "#invoice-event-name",
  eventDate: "#invoice-event-date",
  notes: "#invoice-notes",
  paymentTerms: "#invoice-payment-terms",
  discountAmount: "#invoice-discount",
  taxRate: "#invoice-tax-rate",
};

const openInvoiceEditor = (invoice = null) => {
  activeInvoiceId = invoice?.id || "";
  const values = invoice || {
    status: "Draft",
    issueDate: localDateValue(),
    dueDate: invoiceDueDate(),
    discountAmount: 0,
    taxRate: 0,
    paymentTerms: "Payment is due by the date shown above.",
  };
  Object.entries(invoiceFormFields).forEach(([key, selector]) => {
    $(selector).value = values[key] ?? "";
  });
  invoiceItems = (invoice?.items?.length ? invoice.items : [
    { id: crypto.randomUUID(), description: "", quantity: 1, rate: 0 },
  ]).map((item) => ({ ...item, id: item.id || crypto.randomUUID() }));
  const number = invoice?.invoiceNumber || "New invoice";
  $("#editor-invoice-number").textContent = number;
  $("#invoice-number-display").textContent = invoice?.invoiceNumber || "Draft";
  $("#send-invoice").textContent = invoice?.status === "Sent" ? "Send again" : "Send invoice";
  setMessage($("#invoice-editor-message"), "");
  renderInvoiceItems();
  const inactive = Boolean(invoice?.archivedAt || invoice?.deletedAt);
  const locked = Boolean(invoice && invoice.status !== "Draft");
  $("#revise-invoice").hidden = !locked || inactive;
  $("#mark-invoice-paid").hidden = invoice?.status !== "Sent" || inactive;
  $("#invoice-form").querySelectorAll("input, textarea, select, button").forEach((control) => {
    control.disabled = (inactive || locked) && !["close-invoice-editor", "print-invoice", "revise-invoice", "mark-invoice-paid"].includes(control.id);
  });
  $("#invoice-status").disabled = true;
  if (inactive) setMessage($("#invoice-editor-message"), "Restore this invoice before editing or sending it.");
  else if (locked) setMessage($("#invoice-editor-message"), "This sent record is preserved. Create a revised draft to change and resend it.");
  $("#invoice-editor-dialog").showModal();
  resizeInvoiceTextareas();
};

const invoicePayload = () => ({
  ...(activeInvoiceId ? { id: activeInvoiceId } : {}),
  ...Object.fromEntries(
    Object.entries(invoiceFormFields).map(([key, selector]) => [key, $(selector).value]),
  ),
  items: invoiceItems,
});

const documentVersionHistory = (versions, kind) => {
  if (versions.length < 2) return "";
  const attr = kind === "invoice" ? "data-invoice-id" : "data-contract-id";
  const row = (document) => `<button type="button" ${attr}="${escapeHTML(document.id)}"><span>Version ${escapeHTML(document.revisionNumber || 1)} · ${escapeHTML(document.status)}</span><span>${escapeHTML(document.invoiceNumber || document.contractNumber || "")}</span></button>`;
  return `<details class="document-version-history"><summary>Version history (${versions.length})</summary>
    ${versions.slice(1, 5).map(row).join("")}
    ${versions.length > 5 ? `<details><summary>${versions.length - 5} older archived versions</summary>${versions.slice(5).map(row).join("")}</details>` : ""}
    </details>`;
};

const renderInvoices = () => {
  const list = $("#invoice-list");
  const empty = $("#invoice-empty");
  const visible = invoices.filter((invoice) => invoiceView === "deleted" ? invoice.deletedAt : invoiceView === "archived" ? invoice.archivedAt : !invoice.archivedAt && !invoice.deletedAt);
  const groups = groupDocumentVersions(visible);
  document.querySelectorAll("[data-invoice-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.invoiceView === invoiceView));
  });
  empty.hidden = groups.length > 0;
  list.hidden = groups.length === 0;
  $("#invoice-empty h3").textContent = invoiceView === "active" ? "No invoices yet" : invoiceView === "archived" ? "No archived invoices" : "No deleted invoices";
  $("#invoice-empty p").textContent = invoiceView === "active" ? "Create the first branded invoice for an HMP client." : invoiceView === "archived" ? "Archived invoices can be restored here." : "Deleted invoices are kept here and can be restored.";
  $("#empty-create-invoice").hidden = invoiceView !== "active";
  list.innerHTML = groups
    .map(
      (versions) => { const invoice = versions[0]; return `
      <div class="invoice-list-entry" data-search-text="${escapeHTML(searchText(invoice.eventName, invoice.eventAddress, invoice.eventDate, invoice.clientPhone, invoice.notes, invoice.paymentTerms, invoice.total, (invoice.items || []).map(item => item.description)))}">
        <button class="invoice-list-row" type="button" data-invoice-id="${escapeHTML(invoice.id)}">
          <span><strong>${escapeHTML(invoice.invoiceNumber)}</strong><small>Version ${escapeHTML(invoice.revisionNumber || 1)} · ${escapeHTML(formatDate(invoice.issueDate))}</small></span>
          <span><strong>${escapeHTML(invoice.clientName)}</strong><small>${escapeHTML(invoice.clientEmail)}</small></span>
          <span>${escapeHTML(formatDate(invoice.dueDate))}</span>
          <span class="invoice-list-total">${formatMoney(invoice.total)}</span>
          <span class="status-pill">${escapeHTML(invoice.status)}</span>
        </button>
        <div class="invoice-row-actions">
          ${invoiceView === "active" ? `<button type="button" data-invoice-action="archive" data-invoice-id="${escapeHTML(invoice.id)}" aria-label="Archive invoice ${escapeHTML(invoice.invoiceNumber)}">Archive</button><button type="button" data-invoice-action="delete" data-invoice-id="${escapeHTML(invoice.id)}" aria-label="Delete invoice ${escapeHTML(invoice.invoiceNumber)}">Delete</button>` : `<button type="button" data-invoice-action="restore" data-invoice-id="${escapeHTML(invoice.id)}" aria-label="Restore invoice ${escapeHTML(invoice.invoiceNumber)}">Restore</button>${invoiceView === "archived" ? `<button type="button" data-invoice-action="delete" data-invoice-id="${escapeHTML(invoice.id)}" aria-label="Delete invoice ${escapeHTML(invoice.invoiceNumber)}">Delete</button>` : ""}`}
        </div>
        ${documentVersionHistory(versions, "invoice")}
      </div>`; },
    )
    .join("");
};

const changeInvoiceFolder = async (invoice, action) => {
  if (action === "delete" && !window.confirm(`Move ${invoice.invoiceNumber} to Deleted? It will be hidden from active invoices but can be restored later.`)) return;
  const message = $("#invoice-list-message");
  setMessage(message, `${action === "restore" ? "Restoring" : action === "archive" ? "Archiving" : "Deleting"} invoice…`);
  try {
    const response = await fetch("/api/hmp-invoices", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invoice.id, action }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Invoice could not be updated.");
    invoices = invoices.map((item) => item.id === invoice.id ? data.invoice : item);
    renderInvoices();
    if (activeWorkspaceView === "drafts") renderCurrentDrafts();
    setMessage(message, `Invoice ${action === "delete" ? "moved to Deleted" : action === "archive" ? "archived" : "restored to Active"}.`, true);
  } catch (error) {
    setMessage(message, error.message || "Invoice could not be updated.");
  }
};

const loadInvoices = async () => {
  const response = await fetch("/api/hmp-invoices", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Invoice data is unavailable.");
  const data = await response.json();
  invoices = data.invoices || [];
  invoiceEmailConfigured = Boolean(data.emailConfigured);
  $("#email-setup-notice").hidden = invoiceEmailConfigured;
  renderInvoices();
};

const contractFormFields = {
  status: "#contract-status",
  clientName: "#contract-client-name",
  clientEmail: "#contract-client-email",
  clientPhone: "#contract-client-phone",
  clientAddress: "#contract-client-address",
  effectiveDate: "#contract-effective-date",
  eventName: "#contract-event-name",
  eventDate: "#contract-event-date",
  eventLocation: "#contract-event-location",
  services: "#contract-services",
  scopeOfWork: "#contract-scope",
  totalAmount: "#contract-total-amount",
  retainerAmount: "#contract-retainer-amount",
  paymentTerms: "#contract-payment-terms",
  cancellationTerms: "#contract-cancellation-terms",
  additionalTerms: "#contract-additional-terms",
  hmpSignatureName: "#contract-hmp-signature-name",
  hmpSignedAt: "#contract-hmp-signed-at",
  clientSignatureName: "#contract-client-signature-name",
  clientSignedAt: "#contract-client-signed-at",
};

const openContractEditor = (contract = null) => {
  activeContractId = contract?.id || "";
  const values = contract || {
    status: "Draft",
    effectiveDate: localDateValue(),
    totalAmount: 0,
    retainerAmount: 0,
    hmpSignatureName: "HMP Luxury Event Services",
  };
  Object.entries(contractFormFields).forEach(([key, selector]) => {
    $(selector).value = values[key] ?? "";
  });
  $("#editor-contract-number").textContent = contract?.contractNumber || "New contract";
  $("#contract-number-display").textContent = contract?.contractNumber || "Draft";
  $("#send-contract").textContent = contract?.status === "Sent" ? "Send again" : "Send contract";
  setMessage($("#contract-editor-message"), "");
  const locked = Boolean(contract && contract.status !== "Draft");
  $("#revise-contract").hidden = !locked || contract?.status === "Void";
  $("#mark-contract-signed").hidden = contract?.status !== "Sent";
  $("#contract-form").querySelectorAll("input, textarea, select, button").forEach((control) => {
    control.disabled = locked && !["close-contract-editor", "print-contract", "revise-contract", "mark-contract-signed", "contract-client-signature-name", "contract-client-signed-at"].includes(control.id);
  });
  $("#contract-status").disabled = true;
  if (locked) setMessage($("#contract-editor-message"), "This sent record is preserved. Create a revised draft to change and resend it.");
  $("#contract-editor-dialog").showModal();
};

const contractPayload = () => ({
  ...(activeContractId ? { id: activeContractId } : {}),
  ...Object.fromEntries(
    Object.entries(contractFormFields).map(([key, selector]) => [key, $(selector).value]),
  ),
});

const renderContracts = () => {
  const list = $("#contract-list");
  const empty = $("#contract-empty");
  const groups = groupDocumentVersions(contracts);
  empty.hidden = groups.length > 0;
  list.hidden = groups.length === 0;
  list.innerHTML = groups
    .map(
      (versions) => { const contract = versions[0]; return `<div class="contract-list-entry">
        <button class="invoice-list-row contract-list-row" type="button" data-contract-id="${escapeHTML(contract.id)}" data-search-text="${escapeHTML(searchText(contract.eventName, contract.eventLocation, contract.eventDate, contract.clientPhone, contract.services, contract.scopeOfWork, contract.totalAmount, contract.paymentTerms, contract.additionalTerms))}">
          <span><strong>${escapeHTML(contract.contractNumber)}</strong><small>Version ${escapeHTML(contract.revisionNumber || 1)} · ${escapeHTML(formatDate(contract.effectiveDate))}</small></span>
          <span><strong>${escapeHTML(contract.clientName)}</strong><small>${escapeHTML(contract.clientEmail)}</small></span>
          <span>${escapeHTML(formatDate(contract.eventDate))}</span>
          <span class="invoice-list-total">${formatMoney(contract.totalAmount)}</span>
          <span class="status-pill">${escapeHTML(contract.status)}</span>
        </button>${documentVersionHistory(versions, "contract")}</div>`; },
    )
    .join("");
};

const loadContracts = async () => {
  const response = await fetch("/api/hmp-contracts", { credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Contract data is unavailable.");
  contracts = data.contracts || [];
  contractEmailConfigured = Boolean(data.emailConfigured);
  $("#contract-email-setup-notice").hidden = contractEmailConfigured;
  renderContracts();
};

const renderCurrentDrafts = () => renderDraftGroups(
  $("#drafts-groups"),
  collectDraftGroups({ proposals: proposalDrafts, invoices, contracts, forms: savedFormDrafts }),
  (kind, row) => {
    if (kind === "proposal") return openProposalDraft(proposalDrafts.find((draft) => draft.id === row.id));
    if (kind === "invoice") return openInvoiceEditor(invoices.find((invoice) => invoice.id === row.id));
    if (kind === "contract") return openContractEditor(contracts.find((contract) => contract.id === row.id));
    if (kind === "form") return row.informationForm
      ? openInformationDraft(row.id)
      : openAgreementDraft(row.id);
  },
);

const loadDrafts = async () => {
  setMessage($("#drafts-status"), "Loading saved drafts…");
  const [proposalResponse, formResponse] = await Promise.all([
    fetch("/api/hmp-proposal-drafts", { credentials: "same-origin", cache: "no-store" }),
    fetch("/api/hmp-agreement-forms", { credentials: "same-origin", cache: "no-store" }),
    loadInvoices(), loadContracts(), loadMessages(),
  ]);
  const [proposalData, formData] = await Promise.all([
    proposalResponse.json().catch(() => ({})), formResponse.json().catch(() => ({})),
  ]);
  if (!proposalResponse.ok || !formResponse.ok) throw new Error(proposalData.error || formData.error || "Drafts could not be loaded.");
  proposalDrafts = proposalData.drafts || [];
  savedFormDrafts = formData.agreements || [];
  renderCurrentDrafts();
  setMessage($("#drafts-status"), "Drafts are private until sent or shared.", true);
};

const saveContract = async ({ quiet = false } = {}) => {
  const form = $("#contract-form");
  if (!form.reportValidity()) return null;
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  if (!quiet) setMessage($("#contract-editor-message"), "Saving contract…");
  try {
    const response = await fetch("/api/hmp-contracts", {
      method: activeContractId ? "PATCH" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contractPayload()),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Contract could not be saved.");
    activeContractId = data.contract.id;
    contracts = [data.contract, ...contracts.filter((item) => item.id !== data.contract.id)];
    $("#editor-contract-number").textContent = data.contract.contractNumber;
    $("#contract-number-display").textContent = data.contract.contractNumber;
    renderContracts();
    if (activeWorkspaceView === "drafts") renderCurrentDrafts();
    if (!quiet) setMessage($("#contract-editor-message"), "Contract saved.", true);
    return data.contract;
  } catch (error) {
    setMessage($("#contract-editor-message"), error.message || "Contract could not be saved.");
    return null;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
};

const reviseSavedDocument = async (kind) => {
  const invoice = kind === "invoice";
  const id = invoice ? activeInvoiceId : activeContractId;
  const status = $(invoice ? "#invoice-editor-message" : "#contract-editor-message");
  const button = $(invoice ? "#revise-invoice" : "#revise-contract");
  if (!id) return;
  button.disabled = true;
  setMessage(status, "Creating a linked draft…");
  try {
    const response = await fetch(invoice ? "/api/hmp-invoices" : "/api/hmp-contracts", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revise", id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "A revised draft could not be created.");
    const document = invoice ? data.invoice : data.contract;
    if (invoice) {
      invoices = [document, ...invoices];
      $("#invoice-editor-dialog").close();
      renderInvoices();
      openInvoiceEditor(document);
      setMessage($("#invoice-editor-message"), `Version ${document.revisionNumber} is a private draft. The previous invoice remains unchanged.`, true);
    } else {
      contracts = [document, ...contracts];
      $("#contract-editor-dialog").close();
      renderContracts();
      openContractEditor(document);
      setMessage($("#contract-editor-message"), `Version ${document.revisionNumber} is a private draft. The previous contract remains unchanged.`, true);
    }
  } catch (error) { setMessage(status, error.message || "A revised draft could not be created."); }
  finally { button.disabled = false; }
};

const markDocumentComplete = async (kind) => {
  const invoice = kind === "invoice";
  const id = invoice ? activeInvoiceId : activeContractId;
  const status = $(invoice ? "#invoice-editor-message" : "#contract-editor-message");
  const button = $(invoice ? "#mark-invoice-paid" : "#mark-contract-signed");
  if (!id) return;
  const signatureName = invoice ? "" : $("#contract-client-signature-name").value.trim();
  const signedAt = invoice ? "" : $("#contract-client-signed-at").value;
  if (!invoice && (!signatureName || !signedAt)) {
    setMessage(status, "Enter the client's signing name and date before marking this contract signed.");
    return;
  }
  if (!window.confirm(invoice ? "Mark this invoice paid?" : "Mark this contract signed?")) return;
  button.disabled = true;
  try {
    const response = await fetch(invoice ? "/api/hmp-invoices" : "/api/hmp-contracts", {
      method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: invoice ? "mark-paid" : "mark-signed", clientSignatureName: signatureName, clientSignedAt: signedAt }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Status could not be updated.");
    if (invoice) {
      invoices = invoices.map((item) => item.id === id ? data.invoice : item);
      $("#invoice-status").value = "Paid";
      renderInvoices();
    } else {
      contracts = contracts.map((item) => item.id === id ? data.contract : item);
      $("#contract-status").value = "Signed";
      renderContracts();
    }
    button.hidden = true;
    setMessage(status, invoice ? "Invoice marked paid. Its contents remain locked." : "Contract marked signed. Its contents remain locked.", true);
  } catch (error) { setMessage(status, error.message || "Status could not be updated."); }
  finally { button.disabled = false; }
};

const copyDocumentLink = async (kind) => {
  const invoice = kind === "invoice";
  const message = $(invoice ? "#invoice-editor-message" : "#contract-editor-message");
  const button = $(invoice ? "#copy-invoice-link" : "#copy-contract-link");
  const saved = await (invoice ? saveInvoice({ quiet: true }) : saveContract({ quiet: true }));
  if (!saved) return;
  button.disabled = true;
  setMessage(message, "Preparing a private client link…");
  try {
    const response = await fetch("/api/hmp-documents/share", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id: saved.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Client link could not be prepared.");
    await copyText(data.clientUrl);
    setMessage(message, "Private client link copied. Text it only to this client; they will need their portal PIN. No email was sent.", true);
    loadMessages().catch(() => {});
  } catch (error) {
    setMessage(message, error.message || "Client link could not be copied.");
  } finally { button.disabled = false; }
};

const documentSendRequests = new Map();
const documentSendRequestId = (kind, saved) => {
  // Keep the provider key when retrying unchanged content after a failed send.
  const {updatedAt,createdAt,inquiryId,status,sentAt,sentTo,...content}=saved;
  const key=JSON.stringify([kind,content]);
  if (!documentSendRequests.has(key)) documentSendRequests.set(key,crypto.randomUUID());
  return {key,id:documentSendRequests.get(key)};
};

const sendContract = async () => {
  const saved = await saveContract({ quiet: true });
  if (!saved) return;
  const recipient = $("#contract-client-email").value.trim();
  if (!contractEmailConfigured) {
    setMessage($("#contract-editor-message"), "Contract saved. Email delivery still needs a verified HMP sender.");
    return;
  }
  if (!window.confirm(`Send ${saved.contractNumber} to ${recipient}?`)) return;
  const sendRequest=documentSendRequestId("contract",saved);
  const button = $("#send-contract");
  button.disabled = true;
  setMessage($("#contract-editor-message"), `Sending contract to ${recipient}…`);
  try {
    const response = await fetch("/api/hmp-contracts/send", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: saved.id, recipient, requestId: sendRequest.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Contract email could not be sent.");
    documentSendRequests.delete(sendRequest.key);
    await loadContracts();
    if (activeWorkspaceView === "drafts") renderCurrentDrafts();
    const sent = contracts.find((item) => item.id === saved.id);
    if (sent) { $("#contract-editor-dialog").close(); openContractEditor(sent); }
    setMessage($("#contract-editor-message"), `Contract sent to ${recipient} and added to the client's Messages.`, true);
  } catch (error) {
    setMessage($("#contract-editor-message"), error.message || "Contract email could not be sent.");
  } finally {
    button.disabled = contracts.find((item) => item.id === saved.id)?.status !== "Draft";
  }
};

const renderReviews = () => {
  const list = $("#review-list");
  const empty = $("#review-empty");
  const active = reviews.filter((review) => !review.archivedAt && !review.deletedAt);
  const archived = reviews.filter((review) => review.archivedAt && !review.deletedAt)
    .sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
  const deleted = reviews.filter((review) => review.deletedAt)
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  empty.hidden = active.length > 0;
  list.hidden = active.length === 0;
  $("#review-archive-empty").hidden = archived.length > 0;
  $("#review-archive-list").innerHTML = archived.map((review) => `
    <article class="archived-review">
      <div>
        <span class="status-pill">Archived · Not published</span>
        <h4>${escapeHTML(review.reviewerName)}</h4>
        <p>${escapeHTML(review.reviewerRole || "Client")} · ${escapeHTML(eventServiceLabel(review.service) || "General HMP experience")} · ${escapeHTML(review.rating || 5)} / 5</p>
        <p class="archived-review-text">${escapeHTML(review.reviewText)}</p>
        <small>Archived ${escapeHTML(new Date(review.archivedAt).toLocaleDateString())}</small>
      </div>
      <div class="review-folder-actions"><button class="primary-button" type="button" data-review-folder-action="restore" data-review-id="${escapeHTML(review.id)}" aria-label="Restore review from ${escapeHTML(review.reviewerName)}">Restore review</button><button class="review-delete-button" type="button" data-review-folder-action="delete" data-review-id="${escapeHTML(review.id)}" aria-label="Delete review from ${escapeHTML(review.reviewerName)}">Delete</button></div>
    </article>`).join("");
  $("#review-delete-empty").hidden = deleted.length > 0;
  $("#review-delete-list").innerHTML = deleted.map((review) => `
    <article class="archived-review">
      <div><span class="status-pill">Deleted · Not published</span><h4>${escapeHTML(review.reviewerName)}</h4>
        <p class="archived-review-text">${escapeHTML(review.reviewText)}</p>
        <small>Permanently removed after ${escapeHTML(new Date(Date.parse(review.deletedAt) + 30 * 86400000).toLocaleDateString())}</small></div>
      <button class="primary-button" type="button" data-review-folder-action="restore-deleted" data-review-id="${escapeHTML(review.id)}">Restore review</button>
    </article>`).join("");
  const moons = (rating) => Array.from(
    { length: Math.min(5, Math.max(1, Number(rating) || 5)) },
    () => '<span class="review-list-moon" aria-hidden="true"></span>',
  ).join("");
  list.innerHTML = active
    .map(
      (review) => `
        <button class="review-list-row" type="button" data-review-id="${escapeHTML(review.id)}">
          <span class="review-list-copy"><strong>“${escapeHTML(review.reviewText)}”</strong><small class="review-list-stars" aria-label="${escapeHTML(review.rating || 5)} out of 5">${moons(review.rating)}</small></span>
          <span><strong>${escapeHTML(review.reviewerName)}</strong><small>${escapeHTML(review.reviewerRole || "Client")}</small></span>
          <span>${escapeHTML(eventServiceLabel(review.service) || "General HMP experience")}</span>
          <span>${escapeHTML(review.displayOrder)}</span>
          <span class="review-status"><span class="status-pill">${review.published ? "Published" : review.clientSubmitted ? "Awaiting approval" : "Draft"}</span></span>
        </button>`,
    )
    .join("");
};

const loadReviews = async () => {
  await loadReviewRequests();
  const response = await fetch("/api/hmp-reviews?admin=1", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Review data is unavailable.");
  reviews = data.reviews || [];
  renderReviews();
};

const openReviewEditor = (review = null) => {
  activeReviewId = review?.id || "";
  $("#review-editor-title").textContent = review ? "Edit review" : "Add review";
  $("#review-name").value = review?.reviewerName || "";
  $("#review-role").value = review?.reviewerRole || "";
  const selectedServices = new Set(
    (eventServiceLabel(review?.service) || "General HMP experience").split(",").map((service) => service.trim()),
  );
  document.querySelectorAll('[name="reviewServices"]').forEach((input) => {
    input.checked = selectedServices.has(input.value);
  });
  $("#review-rating").value = String(review?.rating || 5);
  $("#review-order").value = review?.displayOrder ?? (Math.max(0, ...reviews.map((item) => Number(item.displayOrder) || 0)) + 10);
  $("#review-text").value = review?.reviewText || "";
  $("#review-published").checked = Boolean(review?.published);
  $("#approve-review").hidden = !review || review.published;
  $("#archive-review").hidden = !review;
  $("#delete-review").hidden = !review;
  setMessage($("#review-editor-message"), "");
  $("#review-editor-dialog").showModal();
};

const selectedReviewServices = () => Array.from(
  document.querySelectorAll('[name="reviewServices"]:checked'),
  (input) => input.value,
);

const reviewPayload = () => ({
  ...(activeReviewId ? { id: activeReviewId } : {}),
  reviewerName: $("#review-name").value.trim(),
  reviewerRole: $("#review-role").value.trim(),
  service: selectedReviewServices().join(", "),
  rating: Number($("#review-rating").value),
  displayOrder: Number($("#review-order").value) || 0,
  reviewText: $("#review-text").value.trim(),
  published: $("#review-published").checked,
});

const saveReview = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  if (!selectedReviewServices().length) {
    setMessage($("#review-editor-message"), "Select at least one service.");
    document.querySelector('[name="reviewServices"]')?.focus();
    return;
  }
  const addAnotherService = event.submitter?.id === "save-another-review";
  const reviewerName = $("#review-name").value.trim();
  const reviewerRole = $("#review-role").value.trim();
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  setMessage($("#review-editor-message"), "Saving review…");
  try {
    const response = await fetch("/api/hmp-reviews", {
      method: activeReviewId ? "PATCH" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reviewPayload()),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Review could not be saved.");
    const saved = data.review;
    reviews = [saved, ...reviews.filter((review) => review.id !== saved.id)].sort(
      (a, b) => Number(a.displayOrder) - Number(b.displayOrder),
    );
    renderReviews();
    if (addAnotherService) {
      activeReviewId = "";
      form.reset();
      $("#review-editor-title").textContent = "Add another service review";
      $("#approve-review").hidden = true;
      $("#review-name").value = reviewerName;
      $("#review-role").value = reviewerRole;
      $("#review-rating").value = "5";
      $("#review-order").value = Math.max(0, ...reviews.map((item) => Number(item.displayOrder) || 0)) + 10;
      $("#archive-review").hidden = true;
      $("#delete-review").hidden = true;
      setMessage($("#review-editor-message"), "Review saved. Choose the client’s next service and enter their separate review.", true);
      document.querySelector('[name="reviewServices"]')?.focus();
    } else {
      activeReviewId = saved.id;
      $("#archive-review").hidden = false;
      $("#delete-review").hidden = false;
      $("#approve-review").hidden = saved.published;
      setMessage($("#review-editor-message"), saved.published ? "Review approved and published on the website." : "Review saved privately. It is not published on the website.", true);
    }
  } catch (error) {
    setMessage($("#review-editor-message"), error.message || "Review could not be saved.");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
};

const changeReviewFolder = async (review, action, button, message) => {
  if (action === "delete" && !window.confirm(`Move the review from ${review.reviewerName} to Deleted? You can restore it for 30 days; after that it will be permanently removed.`)) return;
  if (action === "archive" && !window.confirm(`Archive the review from ${review.reviewerName}? It will be removed from the website and kept privately until restored.`)) return;
  button.disabled = true;
  setMessage(message, `${action.startsWith("restore") ? "Restoring" : action === "archive" ? "Archiving" : "Deleting"} review…`);
  try {
    const response = await fetch("/api/hmp-reviews", {
      method: "PATCH", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: review.id, action }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Review could not be updated.");
    reviews = reviews.map((item) => item.id === review.id ? data.review : item);
    renderReviews();
    if ($("#review-editor-dialog").open) $("#review-editor-dialog").close();
    const destination = action === "archive" ? $("#review-archive-message") : action === "delete" ? $("#review-delete-message") : message;
    setMessage(destination, action.startsWith("restore") ? "Review restored as a private draft. Approve it to publish." : action === "archive" ? "Review archived privately." : "Review moved to Deleted. Restore it within 30 days.", true);
    if (action.startsWith("restore")) openReviewEditor(data.review);
  } catch (error) {
    setMessage(message, error.message || "Review could not be updated.");
  } finally { button.disabled = false; }
};

const onReviewFolderAction = (event) => {
  const button = event.target.closest("[data-review-folder-action]");
  if (!button) return;
  const review = reviews.find((item) => item.id === button.dataset.reviewId);
  if (review) changeReviewFolder(review, button.dataset.reviewFolderAction, button, button.closest("#review-delete-list") ? $("#review-delete-message") : $("#review-archive-message"));
};

const saveInvoice = async ({ quiet = false } = {}) => {
  const form = $("#invoice-form");
  if (!form.reportValidity()) return null;
  if (!invoiceItems.some((item) => item.description.trim() && Number(item.quantity) > 0)) {
    setMessage($("#invoice-editor-message"), "Add at least one invoice item.");
    return null;
  }

  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  if (!quiet) setMessage($("#invoice-editor-message"), "Saving invoice…");
  try {
    const response = await fetch("/api/hmp-invoices", {
      method: activeInvoiceId ? "PATCH" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invoicePayload()),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Invoice could not be saved.");
    activeInvoiceId = data.invoice.id;
    invoices = [data.invoice, ...invoices.filter((invoice) => invoice.id !== data.invoice.id)];
    $("#editor-invoice-number").textContent = data.invoice.invoiceNumber;
    $("#invoice-number-display").textContent = data.invoice.invoiceNumber;
    renderInvoices();
    if (activeWorkspaceView === "drafts") renderCurrentDrafts();
    if (!quiet) setMessage($("#invoice-editor-message"), "Invoice saved.", true);
    return data.invoice;
  } catch (error) {
    setMessage($("#invoice-editor-message"), error.message || "Invoice could not be saved.");
    return null;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
};

const sendInvoice = async () => {
  const saved = await saveInvoice({ quiet: true });
  if (!saved) return;
  const recipient = $("#invoice-client-email").value.trim();
  if (!invoiceEmailConfigured) {
    setMessage(
      $("#invoice-editor-message"),
      "Invoice saved. Email delivery still needs a verified HMP sender.",
    );
    return;
  }
  if (!window.confirm(`Send ${saved.invoiceNumber} to ${recipient}?`)) return;
  const sendRequest=documentSendRequestId("invoice",saved);

  const button = $("#send-invoice");
  button.disabled = true;
  setMessage($("#invoice-editor-message"), `Sending invoice to ${recipient}…`);
  try {
    const response = await fetch("/api/hmp-invoices/send", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: saved.id, recipient, requestId: sendRequest.id }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Invoice email could not be sent.");
    documentSendRequests.delete(sendRequest.key);
    await loadInvoices();
    if (activeWorkspaceView === "drafts") renderCurrentDrafts();
    const sent = invoices.find((item) => item.id === saved.id);
    if (sent) { $("#invoice-editor-dialog").close(); openInvoiceEditor(sent); }
    setMessage($("#invoice-editor-message"), `Invoice sent to ${recipient} and added to the client's Messages.`, true);
  } catch (error) {
    setMessage($("#invoice-editor-message"), error.message || "Invoice email could not be sent.");
  } finally {
    button.disabled = invoices.find((item) => item.id === saved.id)?.status !== "Draft";
  }
};

const loadDashboard = async () => {
  const response = await fetch("/api/hmp-dashboard", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) {
    await logout().catch(() => {});
    authShell.hidden = false;
    dashboard.hidden = true;
    setMessage(authMessage, "This account does not have HMP admin access.");
    return;
  }
  if (!response.ok) throw new Error("Dashboard data is unavailable.");
  const data = await response.json();
  inquiries = data.inquiries || [];
  $("#viewer-email").textContent = data.viewer?.email || "HMP Admin";
  renderMetrics();
  renderServiceFilter();
  renderServiceMix();
  renderInquiries();
};

const loadActiveWorkspace = () => {
  if (activeWorkspaceView === "drafts") return loadDrafts();
  if (activeWorkspaceView === "reviews") return loadReviews();
  if (activeWorkspaceView === "invoices") return loadInvoices();
  if (activeWorkspaceView === "contracts") return Promise.all([loadContracts(), loadAgreementForms()]);
  if (activeWorkspaceView === "forms") return loadInformationForms();
  if (activeWorkspaceView === "messages") return loadMessages();
  if (activeWorkspaceView === "proposals") return loadMessages();
  return loadDashboard();
};

const syncActiveWorkspace = async () => {
  if (dashboardSyncInProgress || document.hidden || dashboard.hidden) return;
  dashboardSyncInProgress = true;
  try {
    await loadActiveWorkspace();
    $("#sync-state").textContent = `Live · Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date())}`;
  } catch (error) {
    $("#sync-state").textContent = "Reconnecting…";
    throw error;
  } finally {
    dashboardSyncInProgress = false;
  }
};

const startDashboardSync = () => {
  window.clearInterval(dashboardSyncTimer);
  dashboardSyncTimer = window.setInterval(() => {
    syncActiveWorkspace().catch(() => {});
  }, DASHBOARD_SYNC_INTERVAL);
};

const enterDashboard = async (user) => {
  authShell.hidden = true;
  dashboard.hidden = false;
  $("#viewer-email").textContent = user.email || "HMP Admin";
  $("#dashboard-date").textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  setWorkspaceView(new URLSearchParams(location.search).get("view") || "inquiries");
  try {
    const { sharedSessionReady } = await loadAdminWorkspace({ syncSharedSession, loadDashboard, loadMessages });
    $("#sync-state").textContent = sharedSessionReady ? "Live updates on" : "Live updates on · Seating sign-in unavailable";
    startDashboardSync();
  } catch (error) {
    $("#result-count").textContent = error.message;
    $("#sync-state").textContent = "Sync unavailable";
  }
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage(authMessage, "Signing in…");
  try {
    const user = await login($("#login-email").value.trim(), $("#login-password").value);
    await enterDashboard(user);
  } catch (error) {
    setMessage(authMessage, error?.status === 401 ? "The email or password is incorrect." : "We could not sign you in. Please try again.");
  } finally {
    button.disabled = false;
  }
});

$("#forgot-password").addEventListener("click", async () => {
  const email = $("#login-email").value.trim();
  if (!email) {
    setMessage(authMessage, "Enter your admin email first, then select Forgot password.");
    $("#login-email").focus();
    return;
  }
  try {
    await requestPasswordRecovery(email);
    setMessage(authMessage, "Check your email for a secure password reset link.", true);
  } catch {
    setMessage(authMessage, "We could not send a reset link. Confirm the email and try again.");
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("#new-password").value;
  if (password !== $("#confirm-password").value) {
    setMessage(passwordMessage, "The passwords do not match.");
    return;
  }
  try {
    const user = inviteToken
      ? await acceptInvite(inviteToken, password)
      : await updateUser({ password });
    inviteToken = "";
    await enterDashboard(user);
  } catch {
    setMessage(passwordMessage, "We could not save that password. Request a new link and try again.");
  }
});

$("#logout-button").addEventListener("click", async () => {
  window.clearInterval(dashboardSyncTimer);
  await fetch("/api/hmp-sso", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
  await logout();
  location.reload();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncActiveWorkspace().catch(() => {});
});
window.addEventListener("focus", () => syncActiveWorkspace().catch(() => {}));
$("#search-input").addEventListener("input", renderInquiries);
$("#search-input").addEventListener("search", renderInquiries);
$("#clear-inquiry-search").addEventListener("click", () => {
  $("#search-input").value = ""; renderInquiries(); $("#search-input").focus();
});
$("#search-input").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); $("#search-input").value = ""; renderInquiries(); }
});
$("#service-filter").addEventListener("change", renderInquiries);
document.querySelectorAll("[data-inquiry-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeInquiryFilter = button.dataset.inquiryFilter;
    if (activeInquiryFilter === "all") {
      $("#search-input").value = "";
      $("#service-filter").value = "";
    }
    renderInquiries();
  });
});
document.querySelectorAll("[data-workspace-view]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setWorkspaceView(link.dataset.workspaceView, true);
  });
});
const documentTabs = [...document.querySelectorAll("[data-document-view]")];
documentTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => setWorkspaceView(tab.dataset.documentView, true));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % documentTabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + documentTabs.length) % documentTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = documentTabs.length - 1;
    else return;
    event.preventDefault();
    documentTabs[next].focus();
    setWorkspaceView(documentTabs[next].dataset.documentView, true);
  });
});
window.addEventListener("popstate", () => {
  if (!setWorkspaceView(new URLSearchParams(location.search).get("view") || "inquiries")) {
    const url = activeWorkspaceView === "inquiries" ? "/admin" : `/admin?view=${activeWorkspaceView}`;
    history.pushState({ view: activeWorkspaceView }, "", url);
  }
});
inquiryList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-inquiry-id]");
  if (row) openInquiry(row.dataset.inquiryId);
});
$("#dialog-close").addEventListener("click", () => dialog.close());
$("#inquiry-management-form").addEventListener("submit", saveInquiry);
$("#create-conversation-link").addEventListener("click", createConversationLink);
$("#copy-conversation-link").addEventListener("click", async () => {
  try {
    await copyText(activeConversationUrl);
    setMessage($("#conversation-link-message"), "Private client link copied.", true);
  } catch (error) {
    setMessage($("#conversation-link-message"), error.message || "Link could not be copied.");
  }
});
$("#send-new-conversation-link").addEventListener("click", () => {
  if (activeInquiryId) sendNewConversationLink(activeInquiryId, $("#conversation-link-message"));
});
$("#open-conversation").addEventListener("click", () => {
  const thread = messageThreads.find((candidate) => candidate.inquiryId === activeInquiryId);
  if (!thread) return;
  dialog.close();
  setWorkspaceView("messages", true);
  openMessageThread(thread.id);
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

$("#thread-list").addEventListener("click", (event) => {
  const row = event.target.closest("[data-thread-id]");
  if (row) openMessageThread(row.dataset.threadId);
});
$("#hub-form-select").addEventListener("change", () => {
  $("#hub-share-form").disabled = !$("#hub-form-select").value;
});
$("#hub-share-form").addEventListener("click", shareHubForm);
$("#hub-seating-share").addEventListener("submit", shareHubSeating);
$("#message-conversations-tab").addEventListener("click", () => selectMessageTab("conversations"));
$("#message-signature-tab").addEventListener("click", () => selectMessageTab("signature"));
$("#message-signature-form").addEventListener("submit", saveMessageSignature);
$("#insert-message-signature").addEventListener("click", () => {
  const input = $("#admin-message-input");
  const result = insertMessageSignature(input.value, messageSignature, input.maxLength);
  if (result.error) return setMessage($("#admin-message-status"), result.error);
  input.value = result.message;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  setMessage($("#admin-message-status"), "Signature added to the draft. Review it before sending.", true);
});
$("#admin-message-form").addEventListener("submit", sendAdminMessage);
$("#admin-message-attachments").addEventListener("change", () => {
  stageAttachments($("#admin-message-attachments"));
  renderAttachmentPreviews(
    $("#admin-message-attachments"),
    $("#admin-message-attachment-previews"),
    $("#admin-message-attachment-summary"),
  );
});

window.addEventListener("beforeunload", (event) => {
  if (pendingFiles($("#admin-message-attachments")).length || proposalDirtyState.isDirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
$("#copy-active-link").addEventListener("click", async () => {
  try {
    await copyText(activeConversationUrl);
    setMessage($("#admin-message-status"), "Private client link copied.", true);
  } catch (error) {
    setMessage($("#admin-message-status"), error.message || "Link could not be copied.");
  }
});
$("#send-new-active-link").addEventListener("click", () => {
  const thread = messageThreads.find((candidate) => candidate.id === activeThreadId);
  if (thread) sendNewConversationLink(thread.inquiryId, $("#admin-message-status"));
});
$("#reset-client-pin").addEventListener("click", () => {
  const thread = messageThreads.find((candidate) => candidate.id === activeThreadId);
  if (thread) sendNewConversationLink(thread.inquiryId, $("#admin-message-status"), true);
});
$("#delete-active-conversation").addEventListener("click", deleteActiveConversation);
$("#open-proposal-editor").addEventListener("click", openProposalEditor);
$("#create-proposal-button").addEventListener("click", createProposalFromWorkspace);
$("#add-inquiry-button").addEventListener("click", openManualInquiry);
$("#new-client-proposal-button").addEventListener("click", openManualInquiry);
$("#proposal-workspace-new-client").addEventListener("click", openManualInquiry);
$("#proposal-client-select").addEventListener("change", (event) => {
  $("#proposal-workspace-create").disabled = !event.target.value;
});
$("#proposal-workspace-create").addEventListener("click", () => {
  const threadId = $("#proposal-client-select").value;
  if (!threadId) return;
  openMessageThread(threadId);
  if (activeThreadId === threadId) openProposalEditor();
});
$("#close-manual-inquiry").addEventListener("click", () => $("#manual-inquiry-dialog").close());
$("#manual-inquiry-form").addEventListener("submit", createManualInquiry);
$("#close-proposal-editor").addEventListener("click", () => closeProposalEditor());
$("#close-proposal-editor-bottom").addEventListener("click", () => closeProposalEditor());
$("#proposal-service-hours").addEventListener("input", validProposalServiceHours);
$("#proposal-form").addEventListener("submit", sendProposal);
$("#save-proposal-draft").addEventListener("click", saveProposalDraft);
window.addEventListener("hmp-drafts-changed", () => {
  if (activeWorkspaceView === "drafts") loadDrafts().catch((error) => setMessage($("#drafts-status"), error.message));
});
const insertCalendarLink = (value, label) => {
  const url = normalizeCalendarUrl(value);
  if (!url) {
    setMessage($("#admin-message-status"), "Enter a valid https:// calendar link first.");
    return false;
  }
  const messageInput = $("#admin-message-input");
  const prefix = messageInput.value.trim() ? "\n\n" : "";
  const addition = `${prefix}${label}: ${url}`;
  if (messageInput.value.length + addition.length > messageInput.maxLength) {
    setMessage($("#admin-message-status"), "Shorten your reply before adding the calendar link.");
    return false;
  }
  messageInput.value += addition;
  messageInput.focus();
  setMessage($("#admin-message-status"), "Calendar link added to the reply. Click Send reply to share it.");
  return true;
};
$("#insert-hmp-calendar-link").addEventListener("click", () => {
  insertCalendarLink(HMP_BOOKING_CALENDAR_URL, "Book an appointment");
});
$("#insert-calendar-link").addEventListener("click", () => {
  const calendarInput = $("#admin-calendar-url");
  if (insertCalendarLink(calendarInput.value, "Calendar link")) calendarInput.value = "";
  else calendarInput.focus();
});
$("#print-proposal").addEventListener("click", () => {
  if (!validProposalServiceHours()) { $("#proposal-service-hours").reportValidity(); return; }
  printProposal(proposalPayload());
});
$("#proposal-editor-dialog").addEventListener("click", (event) => {
  if (event.target === $("#proposal-editor-dialog")) closeProposalEditor();
});
$("#proposal-editor-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeProposalEditor();
});

$("#create-invoice-button").addEventListener("click", () => openInvoiceEditor());
$("#empty-create-invoice").addEventListener("click", () => openInvoiceEditor());
$("#close-invoice-editor").addEventListener("click", () => $("#invoice-editor-dialog").close());
$("#print-invoice").addEventListener("click", () => window.print());
$("#invoice-sheet").addEventListener("input", resizeInvoiceTextareas);
window.addEventListener("resize", resizeInvoiceTextareas);
// Plain text can wrap and paginate in print; textarea controls can clip content.
window.addEventListener("beforeprint", () => {
  document.querySelectorAll("#invoice-sheet .invoice-print-text").forEach((node) => node.remove());
  document.querySelectorAll("#invoice-sheet textarea").forEach((field) => {
    const text = document.createElement("div");
    text.className = "invoice-print-text";
    text.textContent = field.value;
    field.after(text);
  });
});
window.addEventListener("afterprint", () => {
  document.querySelectorAll("#invoice-sheet .invoice-print-text").forEach((node) => node.remove());
});
$("#send-invoice").addEventListener("click", sendInvoice);
$("#revise-invoice").addEventListener("click", () => reviseSavedDocument("invoice"));
$("#mark-invoice-paid").addEventListener("click", () => markDocumentComplete("invoice"));
$("#copy-invoice-link").addEventListener("click", () => copyDocumentLink("invoice"));
$("#invoice-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveInvoice();
});
$("#add-line-item").addEventListener("click", () => addInvoiceItem());
$("#invoice-items").addEventListener("input", (event) => {
  const input = event.target.closest("[data-item-field]");
  const row = event.target.closest("[data-line-item]");
  if (!input || !row) return;
  const item = invoiceItems.find((candidate) => candidate.id === row.dataset.lineItem);
  if (!item) return;
  item[input.dataset.itemField] = input.dataset.itemField === "description"
    ? input.value
    : Number(input.value);
  calculateInvoiceTotals();
});
$("#invoice-items").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-line-item");
  if (!button) return;
  const row = button.closest("[data-line-item]");
  invoiceItems = invoiceItems.filter((item) => item.id !== row.dataset.lineItem);
  if (!invoiceItems.length) {
    invoiceItems.push({ id: crypto.randomUUID(), description: "", quantity: 1, rate: 0 });
  }
  renderInvoiceItems();
});
$("#invoice-discount").addEventListener("input", calculateInvoiceTotals);
$("#invoice-tax-rate").addEventListener("input", calculateInvoiceTotals);
$(".invoice-view-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-invoice-view]");
  if (!button) return;
  invoiceView = button.dataset.invoiceView;
  setMessage($("#invoice-list-message"), "");
  renderInvoices();
});
$("#invoice-list").addEventListener("click", (event) => {
  const row = event.target.closest("[data-invoice-id]");
  if (!row) return;
  const invoice = invoices.find((candidate) => candidate.id === row.dataset.invoiceId);
  if (!invoice) return;
  const action = row.dataset.invoiceAction;
  if (action) changeInvoiceFolder(invoice, action);
  else openInvoiceEditor(invoice);
});
$("#invoice-editor-dialog").addEventListener("click", (event) => {
  if (event.target === $("#invoice-editor-dialog")) $("#invoice-editor-dialog").close();
});

$("#create-contract-button").addEventListener("click", () => openContractEditor());
$("#empty-create-contract").addEventListener("click", () => openContractEditor());
$("#close-contract-editor").addEventListener("click", () => $("#contract-editor-dialog").close());
$("#print-contract").addEventListener("click", () => {
  document.body.classList.add("printing-contract");
  window.print();
  document.body.classList.remove("printing-contract");
});
$("#send-contract").addEventListener("click", sendContract);
$("#revise-contract").addEventListener("click", () => reviseSavedDocument("contract"));
$("#mark-contract-signed").addEventListener("click", () => markDocumentComplete("contract"));
$("#copy-contract-link").addEventListener("click", () => copyDocumentLink("contract"));
$("#contract-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveContract();
});
$("#contract-list").addEventListener("click", (event) => {
  const row = event.target.closest("[data-contract-id]");
  if (!row) return;
  const contract = contracts.find((candidate) => candidate.id === row.dataset.contractId);
  if (contract) openContractEditor(contract);
});
$("#contract-editor-dialog").addEventListener("click", (event) => {
  if (event.target === $("#contract-editor-dialog")) $("#contract-editor-dialog").close();
});

$("#create-review-button").addEventListener("click", () => openReviewEditor());
$("#empty-create-review").addEventListener("click", () => openReviewEditor());
$("#close-review-editor").addEventListener("click", () => $("#review-editor-dialog").close());
$("#review-form").addEventListener("submit", saveReview);
$("#approve-review").addEventListener("click", () => {
  $("#review-published").checked = true;
  $("#review-form").requestSubmit();
});
$("#review-services").addEventListener("change", (event) => {
  const changed = event.target.closest('[name="reviewServices"]');
  if (!changed || !changed.checked) return;
  const inputs = document.querySelectorAll('[name="reviewServices"]');
  if (changed.value === "General HMP experience") {
    inputs.forEach((input) => { input.checked = input === changed; });
  } else {
    const general = document.querySelector('[name="reviewServices"][value="General HMP experience"]');
    if (general) general.checked = false;
  }
});
$("#archive-review").addEventListener("click", () => {
  const review = reviews.find((item) => item.id === activeReviewId);
  if (review) changeReviewFolder(review, "archive", $("#archive-review"), $("#review-editor-message"));
});
$("#delete-review").addEventListener("click", () => {
  const review = reviews.find((item) => item.id === activeReviewId);
  if (review) changeReviewFolder(review, "delete", $("#delete-review"), $("#review-editor-message"));
});
$("#review-archive-list").addEventListener("click", onReviewFolderAction);
$("#review-delete-list").addEventListener("click", onReviewFolderAction);
$("#review-list").addEventListener("click", (event) => {
  const row = event.target.closest("[data-review-id]");
  if (!row) return;
  const review = reviews.find((candidate) => candidate.id === row.dataset.reviewId);
  if (review) openReviewEditor(review);
});
$("#review-editor-dialog").addEventListener("click", (event) => {
  if (event.target === $("#review-editor-dialog")) $("#review-editor-dialog").close();
});

const initialize = async () => {
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === "invite") {
      inviteToken = callback.token || "";
      showPasswordForm("Your invitation is verified. Choose a password to continue.");
      return;
    }
    if (callback?.type === "recovery") {
      showPasswordForm("Choose a new password for your HMP admin account.");
      return;
    }
    const user = callback?.user || (await getUser());
    if (user) await enterDashboard(user);
  } catch {
    setMessage(authMessage, "Admin sign-in is temporarily unavailable.");
  }
};

initialize();

onAuthChange((event, user) => {
  if (event === AUTH_EVENTS.TOKEN_REFRESH && user) {
    syncSharedSession().catch(() => {});
  }
});
