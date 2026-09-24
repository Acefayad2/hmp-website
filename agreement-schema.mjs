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
export const agreementTemplates = [
  {
    id: "guest-seating", title: "Guest Seating Experience Services Agreement",
    adminFields: [field("selectedService", "Selected service / package", "textarea"), field("guestListDue", "Final guest seating list due", "date"), ...setup, ...payment, ...representative],
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
];
export const getAgreementTemplate = (id) => agreementTemplates.find((item) => item.id === id);

export function validateAnswers(fields, values, requireAll = true) {
  const answers = {};
  for (const field of fields) {
    const value = typeof values?.[field.id] === "string" ? values[field.id].trim() : "";
    if (value.length > (field.type === "textarea" ? 5000 : 500)) throw new Error(`${field.label} is too long.`);
    if (requireAll && field.required && !value) throw new Error(`${field.label} is required.`);
    if (value && field.options && !field.options.includes(value)) throw new Error(`${field.label} is invalid.`);
    if (value && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`${field.label} is invalid.`);
    if (value && ["number", "money"].includes(field.type) && (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 10000000 || (field.type === "number" && !Number.isInteger(Number(value))))) throw new Error(`${field.label} is invalid.`);
    if (value && field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) throw new Error(`${field.label} is invalid.`);
    if (value && field.type === "time" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${field.label} is invalid.`);
    if (value && field.type === "datetime-local" && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error(`${field.label} is invalid.`);
    answers[field.id] = value;
  }
  return answers;
}
