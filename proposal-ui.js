export const PROPOSAL_PREFIX = "HMP_PROPOSAL_V1:";

const text = (value, max = 2000) => typeof value === "string" ? value.trim().slice(0, max) : "";
const number = (value, max = 1_000_000) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : 0;
};

export const normalizeProposal = (value = {}) => ({
  title: text(value.title, 160) || "Service Proposal",
  clientName: text(value.clientName, 200),
  celebrationType: text(value.celebrationType, 200),
  eventDate: text(value.eventDate, 10),
  eventTime: text(value.eventTime, 100),
  eventLocation: text(value.eventLocation, 500),
  guestCount: number(value.guestCount, 100_000),
  serviceHours: number(value.serviceHours, 240),
  associates: number(value.associates, 100),
  machines: number(value.machines, 100),
  serviceDetails: text(value.serviceDetails, 1400),
  notes: text(value.notes, 1600),
  serviceFee: number(value.serviceFee),
  validUntil: text(value.validUntil, 10),
  paymentTerms: text(value.paymentTerms, 600),
});

export const serializeProposal = (proposal) =>
  `${PROPOSAL_PREFIX}${JSON.stringify(normalizeProposal(proposal))}`;

export const parseProposal = (body) => {
  if (typeof body !== "string" || !body.startsWith(PROPOSAL_PREFIX)) return null;
  try {
    return normalizeProposal(JSON.parse(body.slice(PROPOSAL_PREFIX.length)));
  } catch {
    return null;
  }
};

const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

const displayDate = (value) => {
  if (!value) return "To be confirmed";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const lines = (value) => text(value).split(/\n+/).map((line) => line.trim()).filter(Boolean);

const detail = (label, value) => {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value || "To be confirmed";
  row.append(term, description);
  return row;
};

const listSection = (title, items) => {
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  const list = document.createElement("ul");
  heading.textContent = title;
  items.forEach((item) => {
    const entry = document.createElement("li");
    entry.textContent = item;
    list.append(entry);
  });
  section.append(heading, list);
  return section;
};

export const printProposal = (proposal) => {
  const normalized = normalizeProposal(proposal);
  const printable = document.createElement("div");
  printable.className = "proposal-print-page";
  printable.append(renderProposalCard(normalized, { showActions: false }));
  const popup = window.open("", "_blank", "popup");
  if (!popup) return false;
  popup.document.write(`<!doctype html><html><head><title>HMP Service Proposal</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Droid+Serif:wght@400;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="${location.origin}/conversation.css?v=20260915-1"></head><body class="proposal-print-body">${printable.innerHTML}</body></html>`);
  popup.document.close();
  window.setTimeout(() => {
    popup.focus();
    popup.print();
  }, 700);
  return true;
};

export const renderProposalCard = (proposal, { showActions = true } = {}) => {
  const value = normalizeProposal(proposal);
  const article = document.createElement("article");
  article.className = "portal-proposal";

  const header = document.createElement("header");
  const logo = document.createElement("img");
  logo.src = "/assets/brand/hmp-logo-header-2026.png";
  logo.alt = "HMP Luxury Event Services";
  const heading = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.textContent = "Prepared service proposal";
  const title = document.createElement("h3");
  title.textContent = value.title;
  heading.append(eyebrow, title);
  header.append(logo, heading);

  const prepared = document.createElement("p");
  prepared.className = "proposal-prepared-for";
  prepared.textContent = `Prepared for ${value.clientName || "HMP client"}`;

  const details = document.createElement("dl");
  details.className = "proposal-event-details";
  details.append(
    detail("Event", value.celebrationType),
    detail("Date", displayDate(value.eventDate)),
    detail("Time", value.eventTime),
    detail("Location", value.eventLocation),
    detail("Guest count", value.guestCount ? String(value.guestCount) : "To be confirmed"),
    detail("Service hours", value.serviceHours ? String(value.serviceHours) : "To be confirmed"),
  );

  article.append(header, prepared, details);
  const serviceItems = [
    ...(value.associates ? [`${value.associates} Money Associate${value.associates === 1 ? "" : "s"}`] : []),
    ...(value.machines ? [`${value.machines} money counting machine${value.machines === 1 ? "" : "s"}`] : []),
    ...lines(value.serviceDetails),
  ];
  if (serviceItems.length) article.append(listSection("Service details", serviceItems));
  const noteItems = lines(value.notes);
  if (noteItems.length) article.append(listSection("Please note", noteItems));

  const total = document.createElement("div");
  total.className = "proposal-total";
  const totalLabel = document.createElement("span");
  totalLabel.textContent = "HMP service fee";
  const totalValue = document.createElement("strong");
  totalValue.textContent = money(value.serviceFee);
  total.append(totalLabel, totalValue);
  article.append(total);

  if (value.paymentTerms) {
    const terms = document.createElement("p");
    terms.className = "proposal-payment-terms";
    terms.textContent = value.paymentTerms;
    article.append(terms);
  }
  if (value.validUntil) {
    const validity = document.createElement("p");
    validity.className = "proposal-validity";
    validity.textContent = `Pricing valid through ${displayDate(value.validUntil)}.`;
    article.append(validity);
  }
  if (showActions) {
    const actions = document.createElement("div");
    actions.className = "proposal-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Print / Save PDF";
    button.addEventListener("click", () => printProposal(value));
    actions.append(button);
    article.append(actions);
  }
  return article;
};
