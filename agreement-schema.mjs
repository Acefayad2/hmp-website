import { informationTemplates } from "./information-form-schema.mjs";
// Shared field definitions for Admin and the private client form. Terms are versioned separately.
const field = (id, label, type = "text", required = true, options) => ({ id, label, type, required, ...(options ? { options } : {}) });
const eventFields = [
  field("clientName", "Client name"), field("phone", "Phone number", "tel"),
  field("email", "Email address", "email"), field("eventType", "Event type"),
  field("eventDate", "Event date", "date"), field("venue", "Event venue & address", "textarea"),
  field("startTime", "Event start / guest arrival time", "time"),
  field("endTime", "Event end & vendor exit time", "text"),
];
const marketing = field("marketingConsent", "May HMP use event setup images for marketing?", "select", true, ["I agree", "I do not agree"]);
const payment = [
  field("serviceFee", "Total service fee", "money"),
  field("retainer", "50% non-refundable retainer", "money"),
  field("remainingBalance", "Remaining balance", "money"),
  field("paymentDue", "Final payment due", "date"),
];
const setup = [field("setupTime", "Scheduled setup time"), field("removalTime", "Scheduled removal time")];
const representative = [field("representative", "HMP authorized representative"), field("hmpSignature", "HMP representative signature (type full name)")];
export const retainerPercentOptions = Array.from({length:71}, (_, i) => String(i + 30));
const moneyTableDetails = [
  field("agreementDate", "Agreement date", "date"),
  field("serviceFee", "HMP service fee", "money"),
  field("serviceHours", "Service hours", "decimal"),
  {...field("retainerPercent", "Retainer percentage (leave blank for custom terms)", "select", false, retainerPercentOptions), default:"30"},
  field("customPaymentTerms", "Custom payment terms (required when percentage is blank)", "textarea", false),
  {...field("retainerAmount", "Retainer amount (USD)", "money", false), calculated:"money-table-payment", help:"Calculated from the chosen percentage. Blank for custom terms."},
  field("retainerDue", "Retainer due date", "date", false),
  {...field("finalPaymentAmount", "Final payment amount (USD)", "money", false), calculated:"money-table-payment", help:"Service fee minus the retainer; not a payment-status balance."},
  field("finalPaymentDue", "Final payment due date", "date"),
  field("serviceStartTime", "Scheduled service start time", "time"),
  field("serviceEndTime", "Scheduled service end time", "time"),
  field("cancellationDeadline", "Cancellation deadline", "date"),
  field("cancellationRefundAmount", "Refund of final payment before deadline", "money"),
  field("includeCommission", "Include commission-on-large-collections clause?", "select", true, ["No", "Yes"]),
  field("includeTravelFee", "Include travel-fee clause?", "select", true, ["No", "Yes"]),
  field("includeGrandTotal", "Is the Grand Total service booked?", "select", true, ["No", "Yes"]),
  ...representative,
];
const moneyTableClient = [...eventFields, field("guestCount", "Estimated number of guests", "number"), field("vendorAccess", "Venue vendor access time"), field("moneyBank", "Recommended money bank", "money", false), marketing];
export const agreementTemplates = [
  {
    id: "guest-seating", title: "Guest Seating Experience Services Agreement",
    adminFields: [field("selectedService", "Selected service / package", "select", true, ["Guest Arrival", "Arrival + Directory"]), field("guestListDue", "Final guest seating list due", "date"), ...setup, ...payment, ...representative],
    clientFields: [...eventFields, field("guestCount", "Estimated number of guests", "number"), field("vendorAccess", "Venue vendor access time"), marketing],
  },
  {
    id: "accessories", title: "Celebration Accessories Rental Agreement",
    adminFields: [
      ...Array.from({length:4}, (_, i) => [field(`item${i+1}`, `Rental item ${i+1}`, "text", i === 0), field(`quantity${i+1}`, `Item ${i+1} quantity`, "number", i === 0), field(`fee${i+1}`, `Item ${i+1} rental fee`, "money", i === 0)]).flat(),
      field("rentalFee", "Total rental fee", "money"), field("deliveryFee", "Delivery fee (if applicable)", "money", false),
      field("setupFee", "Setup fee (if applicable)", "money", false), field("totalDue", "Total amount due", "money"),
      field("rentalStart", "Rental start date/time", "datetime-local"), field("rentalReturn", "Rental return date/time", "datetime-local"),
      ...payment, field("deliveryTime", "Delivery date/time", "datetime-local", false), field("pickupTime", "Pickup date/time", "datetime-local", false),
      field("setupIncluded", "Setup included", "select", true, ["Yes", "No"]), field("breakdownIncluded", "Breakdown included", "select", true, ["Yes", "No"]),
      field("additionalSetupFee", "Additional setup fee", "money", false), ...representative,
    ],
    clientFields: [...eventFields, marketing],
  },
  {
    id: "welcome-sign", title: "Premium LED Welcome Sign Services Agreement",
    adminFields: [field("selectedService", "Selected service / package", "textarea"), field("contentDue", "Content submission deadline", "date"), field("approvalDue", "Final content approval due", "date"), ...setup, ...payment, ...representative],
    clientFields: [...eventFields, field("eventName", "Event name"), field("guestCount", "Estimated guest count", "number"), field("vendorAccess", "Venue vendor access time"), marketing],
  },
  {
    id: "led-customization", title: "LED Signage Customization & Approval Agreement",
    adminFields: [
      field("customizationFee", "Additional customization fee", "money"), field("additionalWork", "Description of additional work", "textarea"),
      field("contentDue", "Content submission deadline", "date"), field("revisionFee", "Additional revision fee", "money", false),
      field("redesignFee", "Redesign fee (if applicable)", "money", false), field("rushFee", "Rush fee (if applicable)", "money", false),
      field("finalContentDue", "Final content due", "date"), field("proofDate", "Initial proof date", "date"), field("approvalDue", "Final approval due", "date"),
      field("requestedCustomization", "Requested customization", "textarea"), field("approvalFee", "Customization approval: additional fee", "money"), ...representative,
    ],
    clientFields: [field("clientName", "Client name"), field("email", "Email address", "email"),
      field("designApprovalDate", "Design approval date (only if the proof is approved)", "date", false),
      field("designApprovedBy", "Design approved by (leave blank until approved)", "text", false),
      field("customizationApproval", "Customization and associated fee", "select", true, ["I approve the customization and associated additional fee", "I decline the additional customization"]),
      field("customizationSignature", "Customization decision signature (type full name)"),
    ],
  },
  {
    id: "customization-approval", title: "Customization Approval",
    signatureMode:"client-only",
    adminFields:[field("requestedCustomization", "Requested customization", "textarea"), field("approvalFee", "Additional fee", "money")],
    clientFields:[field("clientName", "Client name"), field("email", "Email address", "email"), field("customizationApproval", "Client approval", "select", true, ["I approve the customization and associated additional fee", "I decline the additional customization"])],
  },
  {
    id: "money-collecting", title: "Money Table Service Agreement — Money Collecting",
    adminFields:moneyTableDetails,
    clientFields:moneyTableClient,
  },
  {
    id: "money-collecting-changing", title: "Money Table Service Agreement — Collecting & Changing",
    adminFields:moneyTableDetails,
    clientFields:moneyTableClient,
  },
  {
    id:"money-bank-verification", title:"Money Table Service: Money Bank Verification",
    signatureMode:"on-site-three-signatures",
    optionalSecondRepresentative:true,
    adminFields:[{...field("additionalInformation", "Additional Information", "textarea", false), help:"Leave blank to use the existing Money Bank Verification wording. Anything entered here is included with the form for the signers."}],
    clientFields:[
      field("clientName", "Client name"), field("eventDate", "Event date", "date"), field("eventType", "Event type"),
      field("recommendedBank", "Recommended money bank", "money"), field("actualBank", "Actual money bank received", "money"),
      field("receivedInitials", "First / second designated representative initials at receipt"),
      field("reconciledBank", "Money bank reconciliation at service conclusion", "money"), field("reconciledInitials", "First / second designated representative initials at reconciliation"),
      field("representativeOneName", "First designated representative name"), field("representativeOneSignature", "First representative signature (type full name)"),
      field("representativeOneDate", "First representative signing date", "date"),
      field("representativeTwoName", "Second designated representative name", "text", false), field("representativeTwoSignature", "Second representative signature (type full name)", "text", false),
      field("representativeTwoDate", "Second representative signing date", "date", false),
      field("attendantName", "HMP money attendant name"), field("attendantDate", "HMP attendant signing date", "date"),
    ],
  },
];
export const getAgreementTemplate = (id) => [...agreementTemplates, ...informationTemplates].find((item) => item.id === id);

// Used only when starting a new template, never to rewrite a saved agreement.
export function newAgreementSnapshot(template, source) {
  const snapshot={...template,...source};
  if (template.id === "customization-approval") {
    snapshot.pages = source.pages.map(page => page.replace(/Client Approval:\n☐ I approve the customization and associated additional fee\.\n\n☐ I decline the additional customization\./, "Client Approval:\nPlease record your approval choice in the client approval section of this form."));
  }
  if (["money-collecting","money-collecting-changing"].includes(template.id)) {
    snapshot.version="2026-10-18.1";
    snapshot.pages=source.pages.map(page=>page
      .replace("An initial 30% non-refundable retainer & a signed agreement must be secured prior to any\nservices being performed by Vendor.","{{retainerClause}}")
      .replace("30% Non-Refundable Retainer due by: {{retainerDue}}","{{retainerPayment}}"));
  }
  return snapshot;
}

// Presentation only: keep saved draft wording selectable without rewriting its snapshot.
export function agreementDraftFields(snapshot, answers = {}) {
  if (snapshot.id !== "guest-seating") return snapshot.adminFields;
  const current = getAgreementTemplate(snapshot.id).adminFields.find(field => field.id === "selectedService");
  return snapshot.adminFields.map(field => {
    if (field.id !== current.id || field.options) return field;
    const saved = answers[field.id] || "";
    return {...field, type:"select", options:[...current.options, ...(saved && !current.options.includes(saved) ? [saved] : [])]};
  });
}

export const secondRepresentativeFields = ["representativeTwoName", "representativeTwoSignature", "representativeTwoDate"];
export function requiresSecondRepresentative(snapshot, values = {}, consent = false) {
  return snapshot.optionalSecondRepresentative !== true || consent === true ||
    secondRepresentativeFields.some(id => typeof values[id] === "string" && values[id].trim() !== "");
}

export function validateAnswers(fields, values, requireAll = true) {
  const answers = {};
  const issues = [];
  for (const field of fields) {
    if (field.calculated === "money-table-payment") continue;
    const value = typeof values?.[field.id] === "string" ? values[field.id].trim() : (field.default || "");
    try {
    if (value.length > (field.type === "textarea" ? 5000 : 500)) throw new Error(`${field.label} is too long.`);
    if (requireAll && field.required && !value) throw new Error(`${field.label} is required.`);
    if (value && field.options && !field.options.includes(value)) throw new Error(`${field.label} is invalid.`);
    if (value && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`${field.label} is invalid.`);
    if (value && ["number", "money", "decimal"].includes(field.type) && (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 10000000 || (field.type === "number" && !Number.isInteger(Number(value))))) throw new Error(`${field.label} is invalid.`);
    if (value && field.id === "serviceHours" && Number(value) < 4) throw new Error("Money Table service requires at least four hours.");
    if (value && field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) throw new Error(`${field.label} is invalid.`);
    if (value && field.type === "time" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${field.label} is invalid.`);
    if (value && field.type === "datetime-local" && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error(`${field.label} is invalid.`);
    } catch (error) { issues.push({field:field.id, message:error.message}); }
    answers[field.id] = value;
  }
  if (requireAll && fields.some(field => field.id === "retainerPercent")) {
    if (!answers.retainerPercent && !answers.customPaymentTerms) issues.push({field:"customPaymentTerms",message:"Enter custom payment terms when the retainer percentage is blank."});
    if (answers.retainerPercent && !answers.retainerDue) issues.push({field:"retainerDue",message:"Retainer due date is required for a percentage retainer."});
  }
  if (issues.length) throw validationError(issues);
  const payments = moneyTablePaymentAmounts(answers.serviceFee, answers.retainerPercent);
  for (const field of fields) if (field.calculated === "money-table-payment") answers[field.id] = payments[field.id] || "";
  return answers;
}

export function validationError(issues) {
  const error = new Error(issues.map(issue => issue.message).join("\n"));
  error.issues = issues;
  return error;
}

// Keep the same allowlist on the editor and server; never silently strip draft wording.
const moneyPlaceholders = new Set(["agreementDate", "serviceFee", "serviceHours", "retainerDue", "retainerClause", "retainerPayment", "finalPaymentDue", "serviceStartTime", "serviceEndTime", "cancellationDeadline", "cancellationRefundAmount", "commissionClause", "travelClause", "grandTotalClause"]);
export function agreementTextIssues(snapshot) {
  if (!["money-collecting", "money-collecting-changing"].includes(snapshot.id)) return [];
  return snapshot.pages.flatMap((page, pageIndex) => {
    const issues = [];
    for (const match of page.matchAll(/\{\{[^{}\r\n]*(?:\}\})?|\}\}/g)) {
      const token = match[0];
      if (/^\{\{[A-Za-z]+\}\}$/.test(token) && moneyPlaceholders.has(token.slice(2, -2))) continue;
      const shown = token.length > 100 ? `${token.slice(0, 100)}…` : token;
      issues.push({pageIndex, start:match.index, end:match.index + token.length,
        message:`Agreement page ${pageIndex + 1}: review “${shown}” — unfinished or unrecognized placeholder.`,
        help:"Select an item to jump to it. For a completed amount, date, time, or other value, remove only its double braces. For a template field, restore its correct name."});
    }
    return issues;
  });
}

export function moneyTablePaymentAmounts(serviceFee, percentage = "30") {
  const value = typeof serviceFee === "string" ? serviceFee.trim() : "";
  if (!retainerPercentOptions.includes(percentage) || !/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 10000000) return {retainerAmount:"", finalPaymentAmount:""};
  const cents = Math.round(Number(value)*100), retainerCents = Math.round(cents*Number(percentage)/100);
  return {retainerAmount:(retainerCents/100).toFixed(2), finalPaymentAmount:((cents-retainerCents)/100).toFixed(2)};
}
