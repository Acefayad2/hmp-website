import {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
  logout,
  requestPasswordRecovery,
  updateUser,
} from "@netlify/identity";

const $ = (selector) => document.querySelector(selector);
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
let invoices = [];
let invoiceItems = [];
let activeInvoiceId = "";
let invoiceEmailConfigured = false;
let inviteToken = "";
let activeInquiryId = "";
let reviews = [];
let activeReviewId = "";
let messageThreads = [];
let activeThreadId = "";
let activeConversationUrl = "";
let activeWorkspaceView = "inquiries";

const workspaceViews = {
  inquiries: {
    title: "Inquiry dashboard",
  },
  messages: {
    title: "Client messages",
  },
  invoices: {
    title: "Invoices",
  },
  events: {
    title: "Events",
    label: "Event workspace",
    emptyTitle: "No events yet",
    emptyCopy: "Confirmed celebrations will appear here when event tracking is connected.",
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

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDate = (value, includeTime = false) => {
  const date = parseDate(value);
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
  const view = workspaceViews[requestedView] ? requestedView : "inquiries";
  const config = workspaceViews[view];
  const isInquiries = view === "inquiries";
  const isMessages = view === "messages";
  const isInvoices = view === "invoices";
  const isReviews = view === "reviews";
  activeWorkspaceView = view;

  $(".dashboard-header h1").textContent = config.title;
  $(".metrics").hidden = !isInquiries;
  $(".dashboard-grid").hidden = !isInquiries;
  $("#messages-workspace").hidden = !isMessages;
  $("#invoice-workspace").hidden = !isInvoices;
  $("#reviews-workspace").hidden = !isReviews;
  $("#workspace-empty").hidden = isInquiries || isMessages || isInvoices || isReviews;
  if (!isInquiries && !isMessages && !isInvoices && !isReviews) {
    $("#workspace-empty-label").textContent = config.label;
    $("#workspace-empty-title").textContent = config.emptyTitle;
    $("#workspace-empty-copy").textContent = config.emptyCopy;
  }
  if (isInvoices) {
    loadInvoices().catch((error) => {
      $("#invoice-empty").hidden = false;
      $("#invoice-empty h3").textContent = "Invoices unavailable";
      $("#invoice-empty p").textContent = error.message;
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
    const isActive = link.dataset.workspaceView === view;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (updateUrl) {
    const url = view === "inquiries" ? "/admin" : `/admin?view=${view}`;
    history.pushState({ view }, "", url);
  }
};

const showPasswordForm = (message) => {
  loginForm.hidden = true;
  passwordForm.hidden = false;
  if (message) setMessage(passwordMessage, message, true);
};

const renderMetrics = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = inquiries.filter((item) => {
    const date = parseDate(item.celebrationDate);
    return date && date >= today;
  }).length;
  const largest = Math.max(0, ...inquiries.map((item) => Number(item.guestCount) || 0));
  $("#metric-total").textContent = inquiries.length;
  $("#metric-new").textContent = inquiries.filter(
    (item) => String(item.status).toLowerCase() === "new",
  ).length;
  $("#metric-upcoming").textContent = upcoming;
  $("#metric-guests").textContent = largest || "—";
};

const renderServiceFilter = () => {
  const select = $("#service-filter");
  const current = select.value;
  const services = [...new Set(inquiries.map((item) => item.service).filter(Boolean))].sort();
  select.innerHTML = '<option value="">All services</option>' + services
    .map((service) => `<option value="${escapeHTML(service)}">${escapeHTML(service)}</option>`)
    .join("");
  select.value = current;
};

const renderServiceMix = () => {
  const counts = inquiries.reduce((result, item) => {
    const service = item.service || "Not specified";
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
  return inquiries.filter((item) => {
    const haystack = [item.name, item.email, item.phone, item.service, item.location, item.celebrationType]
      .join(" ")
      .toLowerCase();
    return (!query || haystack.includes(query)) && (!service || item.service === service);
  });
};

const renderInquiries = () => {
  const filtered = filteredInquiries();
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
              <span class="service-cell"><strong>${escapeHTML(item.service || "Service not specified")}</strong><span>${escapeHTML(item.location || item.celebrationType || "Location pending")}</span></span>
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
  ["Celebration date", "celebrationDate"],
  ["Second date", "secondDate"],
  ["Service", "service"],
  ["Celebration type", "celebrationType"],
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
  $("#detail-service").textContent = item.service || "Service not specified";
  $("#detail-actions").innerHTML = [
    item.email ? `<a href="mailto:${encodeURIComponent(item.email)}">Email client</a>` : "",
    item.phone ? `<a href="tel:${escapeHTML(item.phone.replace(/[^+\d]/g, ""))}">Call ${escapeHTML(item.phone)}</a>` : "",
  ].join("");
  renderDetailGrid(item);
  const note = $("#detail-note");
  note.hidden = !item.additionalInformation;
  note.querySelector("p").textContent = item.additionalInformation || "";
  $("#manage-status").value = item.status || "New";
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
    ? "A secure conversation link is active for this inquiry."
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
    setMessage($("#management-message"), "Changes saved securely.", true);
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

const renderAdminMessages = (thread) => {
  const list = $("#admin-message-list");
  list.replaceChildren();
  (thread.messages || []).forEach((message) => {
    const article = document.createElement("article");
    article.className = `admin-message ${message.sender === "admin" ? "admin" : "client"}`;
    const meta = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = message.sender === "admin" ? "HMP representative" : thread.clientName;
    const time = document.createElement("time");
    time.dateTime = message.createdAt;
    time.textContent = formatDate(message.createdAt, true);
    meta.append(name, time);
    const copy = document.createElement("p");
    copy.textContent = message.body;
    article.append(meta, copy);
    list.append(article);
  });
  $("#admin-message-empty").hidden = (thread.messages || []).length > 0;
  list.hidden = (thread.messages || []).length === 0;
  if (!list.hidden) list.scrollTop = list.scrollHeight;
};

const openMessageThread = (threadId) => {
  const thread = messageThreads.find((candidate) => candidate.id === threadId);
  if (!thread) return;
  activeThreadId = thread.id;
  activeConversationUrl = thread.clientUrl;
  $("#admin-conversation-placeholder").hidden = true;
  $("#admin-conversation").hidden = false;
  $("#admin-conversation-name").textContent = thread.clientName;
  $("#admin-conversation-email").textContent = thread.clientEmail;
  $("#admin-conversation-service").textContent = thread.service;
  $("#copy-active-link").textContent = thread.active ? "Copy client link" : "Link expired";
  $("#copy-active-link").disabled = !thread.active;
  setMessage($("#admin-message-status"), "");
  renderAdminMessages(thread);
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
    if (thread.id === activeThreadId) button.classList.add("active");
    const top = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = thread.clientName;
    const date = document.createElement("time");
    date.textContent = thread.lastMessageAt ? formatDate(thread.lastMessageAt, true) : "New link";
    top.append(name, date);
    const service = document.createElement("small");
    service.textContent = thread.service;
    const status = document.createElement("em");
    status.textContent = thread.lastSender === "client" ? "New client reply" : thread.active ? "Private link active" : "Link expired";
    button.append(top, service, status);
    list.append(button);
  });
};

const loadMessages = async () => {
  const response = await fetch("/api/hmp-messages", { credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Messages are unavailable.");
  messageThreads = data.threads || [];
  renderMessageThreads();
  if (activeThreadId && messageThreads.some((thread) => thread.id === activeThreadId)) {
    openMessageThread(activeThreadId);
  }
};

const createConversationLink = async () => {
  if (!activeInquiryId) return;
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

const sendNewConversationLink = async (inquiryId, statusElement) => {
  const inquiry = inquiries.find((candidate) => candidate.id === inquiryId);
  const thread = messageThreads.find((candidate) => candidate.inquiryId === inquiryId);
  const clientName = inquiry?.name || thread?.clientName || "this client";
  const clientEmail = inquiry?.email || thread?.clientEmail || "";
  if (!clientEmail) {
    setMessage(statusElement, "Add a client email before sending a new link.");
    return;
  }
  if (!window.confirm(`Send a new private conversation link to ${clientName} at ${clientEmail}? The previous link will stop working.`)) return;

  const buttons = document.querySelectorAll("#send-new-conversation-link, #send-new-active-link");
  buttons.forEach((button) => { button.disabled = true; });
  setMessage(statusElement, "Creating and emailing a new private link…");
  try {
    const response = await fetch("/api/hmp-messages", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send-link", inquiryId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "New link could not be created.");
    activeConversationUrl = data.clientUrl;
    await loadMessages();
    $("#copy-conversation-link").hidden = false;
    $("#open-conversation").hidden = false;
    $("#create-conversation-link").textContent = "Renew private link";
    if (data.emailed) {
      setMessage(statusElement, `A new private link was emailed to ${clientEmail}.`, true);
    } else {
      setMessage(statusElement, "The new link was created, but email delivery failed. Copy the link and send it manually.");
    }
  } catch (error) {
    setMessage(statusElement, error.message || "New link could not be sent.");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
};

const sendAdminMessage = async (event) => {
  event.preventDefault();
  if (!activeThreadId) return;
  const input = $("#admin-message-input");
  const message = input.value.trim();
  if (!message) return;
  const requestId = globalThis.crypto?.randomUUID?.();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage($("#admin-message-status"), "Sending reply…");
  try {
    const response = await fetch("/api/hmp-messages", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", conversationId: activeThreadId, message, requestId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Reply could not be sent.");
    input.value = "";
    await loadMessages();
    setMessage($("#admin-message-status"), data.notified ? "Reply sent and client notified by email." : "Reply sent securely.", true);
  } catch (error) {
    setMessage($("#admin-message-status"), error.message || "Reply could not be sent.");
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

const renderInvoiceItems = () => {
  $("#invoice-items").innerHTML = invoiceItems
    .map(
      (item) => `
        <div class="invoice-item-row" data-line-item="${escapeHTML(item.id)}">
          <input data-item-field="description" type="text" maxlength="500" value="${escapeHTML(item.description)}" placeholder="Guest Seating Experience" aria-label="Service description" required />
          <input data-item-field="quantity" type="number" min="0.01" step="0.01" value="${escapeHTML(item.quantity)}" aria-label="Quantity" required />
          <input data-item-field="rate" type="number" min="0" step="0.01" value="${escapeHTML(item.rate)}" aria-label="Rate" required />
          <span class="invoice-item-amount">${formatMoney(Number(item.quantity) * Number(item.rate))}</span>
          <button class="remove-line-item" type="button" aria-label="Remove line item">×</button>
        </div>`,
    )
    .join("");
  calculateInvoiceTotals();
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
  $("#invoice-items .invoice-item-row:last-child input").focus();
};

const invoiceFormFields = {
  status: "#invoice-status",
  clientName: "#invoice-client-name",
  clientEmail: "#invoice-client-email",
  clientPhone: "#invoice-client-phone",
  billingAddress: "#invoice-billing-address",
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
  $("#invoice-editor-dialog").showModal();
};

const invoicePayload = () => ({
  ...(activeInvoiceId ? { id: activeInvoiceId } : {}),
  ...Object.fromEntries(
    Object.entries(invoiceFormFields).map(([key, selector]) => [key, $(selector).value]),
  ),
  items: invoiceItems,
});

const renderInvoices = () => {
  const list = $("#invoice-list");
  const empty = $("#invoice-empty");
  empty.hidden = invoices.length > 0;
  list.hidden = invoices.length === 0;
  list.innerHTML = invoices
    .map(
      (invoice) => `
        <button class="invoice-list-row" type="button" data-invoice-id="${escapeHTML(invoice.id)}">
          <span><strong>${escapeHTML(invoice.invoiceNumber)}</strong><small>${escapeHTML(formatDate(invoice.issueDate))}</small></span>
          <span><strong>${escapeHTML(invoice.clientName)}</strong><small>${escapeHTML(invoice.clientEmail)}</small></span>
          <span>${escapeHTML(formatDate(invoice.dueDate))}</span>
          <span class="invoice-list-total">${formatMoney(invoice.total)}</span>
          <span class="status-pill">${escapeHTML(invoice.status)}</span>
        </button>`,
    )
    .join("");
};

const loadInvoices = async () => {
  const response = await fetch("/api/hmp-invoices", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Invoice data is unavailable.");
  const data = await response.json();
  invoices = data.invoices || [];
  invoiceEmailConfigured = Boolean(data.emailConfigured);
  $("#email-setup-notice").hidden = invoiceEmailConfigured;
  renderInvoices();
};

const renderReviews = () => {
  const list = $("#review-list");
  const empty = $("#review-empty");
  empty.hidden = reviews.length > 0;
  list.hidden = reviews.length === 0;
  list.innerHTML = reviews
    .map(
      (review) => `
        <button class="review-list-row" type="button" data-review-id="${escapeHTML(review.id)}">
          <span class="review-list-copy"><strong>“${escapeHTML(review.reviewText)}”</strong><small class="review-list-stars">${"☾".repeat(Number(review.rating) || 5)}</small></span>
          <span><strong>${escapeHTML(review.reviewerName)}</strong><small>${escapeHTML(review.reviewerRole || "Client")}</small></span>
          <span>${escapeHTML(review.service || "General HMP experience")}</span>
          <span>${escapeHTML(review.displayOrder)}</span>
          <span class="review-status"><span class="status-pill">${review.published ? "Published" : "Draft"}</span></span>
        </button>`,
    )
    .join("");
};

const loadReviews = async () => {
  $("#sync-state").textContent = "Refreshing…";
  const response = await fetch("/api/hmp-reviews?admin=1", {
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Review data is unavailable.");
  reviews = data.reviews || [];
  renderReviews();
  $("#sync-state").textContent = `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(data.updatedAt || Date.now()))}`;
};

const openReviewEditor = (review = null) => {
  activeReviewId = review?.id || "";
  $("#review-editor-title").textContent = review ? "Edit review" : "Add review";
  $("#review-name").value = review?.reviewerName || "";
  $("#review-role").value = review?.reviewerRole || "";
  $("#review-service").value = review?.service || "";
  $("#review-rating").value = String(review?.rating || 5);
  $("#review-order").value = review?.displayOrder ?? (Math.max(0, ...reviews.map((item) => Number(item.displayOrder) || 0)) + 10);
  $("#review-text").value = review?.reviewText || "";
  $("#review-published").checked = review ? Boolean(review.published) : true;
  $("#delete-review").hidden = !review;
  setMessage($("#review-editor-message"), "");
  $("#review-editor-dialog").showModal();
};

const reviewPayload = () => ({
  ...(activeReviewId ? { id: activeReviewId } : {}),
  reviewerName: $("#review-name").value.trim(),
  reviewerRole: $("#review-role").value.trim(),
  service: $("#review-service").value,
  rating: Number($("#review-rating").value),
  displayOrder: Number($("#review-order").value) || 0,
  reviewText: $("#review-text").value.trim(),
  published: $("#review-published").checked,
});

const saveReview = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
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
    activeReviewId = saved.id;
    $("#delete-review").hidden = false;
    renderReviews();
    setMessage($("#review-editor-message"), "Review saved and website content updated.", true);
  } catch (error) {
    setMessage($("#review-editor-message"), error.message || "Review could not be saved.");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
};

const deleteReview = async () => {
  const review = reviews.find((item) => item.id === activeReviewId);
  if (!review || !window.confirm(`Delete the review from ${review.reviewerName}?`)) return;
  const button = $("#delete-review");
  button.disabled = true;
  setMessage($("#review-editor-message"), "Deleting review…");
  try {
    const response = await fetch("/api/hmp-reviews", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeReviewId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Review could not be deleted.");
    reviews = reviews.filter((item) => item.id !== activeReviewId);
    renderReviews();
    $("#review-editor-dialog").close();
  } catch (error) {
    setMessage($("#review-editor-message"), error.message || "Review could not be deleted.");
  } finally {
    button.disabled = false;
  }
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

  const button = $("#send-invoice");
  button.disabled = true;
  setMessage($("#invoice-editor-message"), `Sending invoice to ${recipient}…`);
  try {
    const response = await fetch("/api/hmp-invoices/send", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: saved.id, recipient }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Invoice email could not be sent.");
    await loadInvoices();
    $("#invoice-status").value = "Sent";
    $("#send-invoice").textContent = "Send again";
    setMessage($("#invoice-editor-message"), `Invoice sent to ${recipient}.`, true);
  } catch (error) {
    setMessage($("#invoice-editor-message"), error.message || "Invoice email could not be sent.");
  } finally {
    button.disabled = false;
  }
};

const loadDashboard = async () => {
  $("#sync-state").textContent = "Refreshing…";
  const response = await fetch("/api/hmp-dashboard", { credentials: "same-origin" });
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
  $("#sync-state").textContent = `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(data.updatedAt))}`;
  renderMetrics();
  renderServiceFilter();
  renderServiceMix();
  renderInquiries();
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
  try {
    await Promise.all([loadDashboard(), loadMessages()]);
    setWorkspaceView(new URLSearchParams(location.search).get("view") || "inquiries");
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
  await logout();
  location.reload();
});
$("#refresh-button").addEventListener("click", () => {
  if (activeWorkspaceView === "reviews") return loadReviews();
  if (activeWorkspaceView === "invoices") return loadInvoices();
  if (activeWorkspaceView === "messages") return loadMessages();
  return loadDashboard();
});
$("#search-input").addEventListener("input", renderInquiries);
$("#service-filter").addEventListener("change", renderInquiries);
document.querySelectorAll("[data-workspace-view]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    setWorkspaceView(link.dataset.workspaceView, true);
  });
});
window.addEventListener("popstate", () => {
  setWorkspaceView(new URLSearchParams(location.search).get("view") || "inquiries");
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
$("#admin-message-form").addEventListener("submit", sendAdminMessage);
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

$("#create-invoice-button").addEventListener("click", () => openInvoiceEditor());
$("#empty-create-invoice").addEventListener("click", () => openInvoiceEditor());
$("#close-invoice-editor").addEventListener("click", () => $("#invoice-editor-dialog").close());
$("#print-invoice").addEventListener("click", () => window.print());
$("#send-invoice").addEventListener("click", sendInvoice);
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
$("#invoice-list").addEventListener("click", (event) => {
  const row = event.target.closest("[data-invoice-id]");
  if (!row) return;
  const invoice = invoices.find((candidate) => candidate.id === row.dataset.invoiceId);
  if (invoice) openInvoiceEditor(invoice);
});
$("#invoice-editor-dialog").addEventListener("click", (event) => {
  if (event.target === $("#invoice-editor-dialog")) $("#invoice-editor-dialog").close();
});

$("#create-review-button").addEventListener("click", () => openReviewEditor());
$("#empty-create-review").addEventListener("click", () => openReviewEditor());
$("#close-review-editor").addEventListener("click", () => $("#review-editor-dialog").close());
$("#review-form").addEventListener("submit", saveReview);
$("#delete-review").addEventListener("click", deleteReview);
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
