import { createHash, createHmac, randomBytes } from "node:crypto";
import terms from "../../data/agreement-terms.json" with { type: "json" };
import { getAgreementTemplate, requiresSecondRepresentative, secondRepresentativeFields, validateAnswers } from "../../agreement-schema.mjs";

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const nonce = () => randomBytes(24).toString("base64url");
export const agreementToken = (id: string, seed: string) => {
  const secret = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Agreement security is unavailable.");
  return createHmac("sha256", secret).update(`hmp-agreement:v1:${id}:${seed}`).digest("base64url");
};
export const privateLink = (row: any) => `https://hmpeds.com/agreement#token=${agreementToken(row.id, row.token_nonce)}`;
export const snapshotFor = (id: string) => {
  const template = getAgreementTemplate(id);
  if (template?.kind === "information") return {...template};
  const source = (terms as Record<string, any>)[id];
  if (!template || !source) throw new Error("Choose an agreement template.");
  return { ...template, ...source, signingConsent };
};
// Add the missing field to editable drafts only; never rewrite issued/signed snapshots.
export function withCurrentDraftFields(row: any) {
  const snapshot = row.snapshot;
  if (row.status === "Draft" && snapshot.id === "money-bank-verification" && snapshot.optionalSecondRepresentative !== true) {
    const current = snapshotFor(snapshot.id);
    const changedIds = [...secondRepresentativeFields, "receivedInitials", "reconciledInitials"];
    return {...row, snapshot:{...snapshot, version:current.version, optionalSecondRepresentative:true,
      clientFields:snapshot.clientFields.map((field: any) => changedIds.includes(field.id) ? current.clientFields.find((item: any) => item.id === field.id) : field)}};
  }
  if (row.status !== "Draft" || !["money-collecting", "money-collecting-changing"].includes(snapshot.id) ||
      snapshot.adminFields.some((field: any) => field.id === "serviceStartTime")) return row;
  const startField = getAgreementTemplate(snapshot.id).adminFields.find((field: any) => field.id === "serviceStartTime");
  const fields = [...snapshot.adminFields];
  const endIndex = fields.findIndex((field: any) => field.id === "serviceEndTime");
  fields.splice(endIndex < 0 ? fields.length : endIndex, 0, startField);
  return {...row, snapshot:{...snapshot, adminFields:fields}};
}
export function editableSnapshot(snapshot: any, body: any) {
  const title = typeof body.title === "string" ? body.title.trim() : snapshot.title;
  if (!title || title.length > 200) throw new Error("Document title is required (maximum 200 characters).");
  if (snapshot.kind === "information") {
    const description = typeof body.description === "string" ? body.description.trim() : snapshot.description;
    if (!description || description.length > 5000) throw new Error("Form introduction is required (maximum 5,000 characters).");
    return {...snapshot, title, description};
  }
  const pages = body.pages === undefined ? snapshot.pages : body.pages;
  if (!Array.isArray(pages) || pages.length !== snapshot.pages.length ||
      pages.some((page: unknown) => typeof page !== "string" || !page.trim() || page.length > 15000) ||
      pages.join("").length > 85000) throw new Error("Review every agreement page; one or more pages are missing or too long.");
  return {...snapshot, title, pages:pages.map((page: string) => page.trim())};
}
export function issuedSnapshot(snapshot: any, adminAnswers: Record<string, string>) {
  if (!["money-collecting", "money-collecting-changing"].includes(snapshot.id)) return snapshot;
  const {optionalClauses = {}, ...issued} = snapshot;
  const replacements: Record<string, string> = {
    agreementDate:adminAnswers.agreementDate,
    serviceFee:`$${Number(adminAnswers.serviceFee).toFixed(2)}`,
    serviceHours:adminAnswers.serviceHours,
    retainerDue:adminAnswers.retainerDue,
    finalPaymentDue:adminAnswers.finalPaymentDue,
    serviceStartTime:adminAnswers.serviceStartTime,
    serviceEndTime:adminAnswers.serviceEndTime,
    cancellationDeadline:adminAnswers.cancellationDeadline,
    cancellationRefundAmount:`$${Number(adminAnswers.cancellationRefundAmount).toFixed(2)}`,
    commissionClause:adminAnswers.includeCommission === "Yes" ? optionalClauses.commissionClause : "",
    travelClause:adminAnswers.includeTravelFee === "Yes" ? optionalClauses.travelClause : "",
    grandTotalClause:adminAnswers.includeGrandTotal === "Yes" ? "The final total will be presented to the Client at the conclusion of the service." : "",
  };
  const pages = snapshot.pages.map((page: string) => page.replace(/\{\{([A-Za-z]+)\}\}/g, (_: string, key: string) => {
    if (typeof replacements[key] !== "string") throw new Error(`Unrecognized agreement field: ${key}`);
    return replacements[key];
  }));
  if (pages.some((page: string) => /\{\{/.test(page))) throw new Error("Agreement text has an unfinished placeholder.");
  return {...issued, pages};
}
export const cleanContact = (body: any) => {
  const name = typeof body.clientName === "string" ? body.clientName.trim() : "";
  const email = typeof body.clientEmail === "string" ? body.clientEmail.trim().toLowerCase() : "";
  if (!name || name.length > 200) throw new Error("Client name is required (maximum 200 characters).");
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid client email is required.");
  return { client_name: name, client_email: email };
};
export const signingConsent = "I have reviewed this agreement and the completed details, agree to its terms, and consent to using electronic records and my typed name as my electronic signature. I can print or save a copy. To use a paper form instead, I can contact info@hmpeds.com before signing.";
export function completionPayload(row: any, body: any, userAgent = "", now = new Date().toISOString()) {
  if (row.status !== "Sent" || !row.expires_at || Date.parse(row.expires_at) <= Date.parse(now)) throw new Error("This agreement is not open for completion.");
  if (row.snapshot.kind === "information") {
    const answers = validateAnswers(row.snapshot.clientFields, body.answers);
    return {client_answers:answers, signature:null, record_hash:hash(JSON.stringify({id:row.id, snapshot:row.snapshot, answers, completedAt:now})), completed_at:now, updated_at:now, status:"Completed"};
  }
  if (body.consent !== true) throw new Error("Please consent to electronic signing and accept the agreement.");
  const name = typeof body.signatureName === "string" ? body.signatureName.trim() : "";
  if (name.length < 2 || name.length > 200) throw new Error("Type your full name to sign.");
  const answers = validateAnswers(row.snapshot.clientFields, body.answers);
  let secondRepresentativeSigned = false;
  if (row.snapshot.signatureMode === "on-site-three-signatures") {
    secondRepresentativeSigned = requiresSecondRepresentative(row.snapshot, answers, body.representativeTwoConsent);
    if (body.representativeOneConsent !== true) throw new Error("The first designated representative must consent to their typed signature.");
    if (answers.representativeOneName.toLocaleLowerCase() !== answers.representativeOneSignature.toLocaleLowerCase()) throw new Error("First representative signature must match the first representative name.");
    if (secondRepresentativeSigned) {
      validateAnswers(row.snapshot.clientFields.filter((field: any) => secondRepresentativeFields.includes(field.id)).map((field: any) => ({...field, required:true})), answers);
      if (body.representativeTwoConsent !== true) throw new Error("The second designated representative must consent to their typed signature, or leave all second representative fields blank.");
      if (answers.representativeTwoName.toLocaleLowerCase() !== answers.representativeTwoSignature.toLocaleLowerCase()) throw new Error("Second representative signature must match the second representative name.");
    }
    if (answers.attendantName.toLocaleLowerCase() !== name.toLocaleLowerCase()) throw new Error("HMP attendant signature must match the HMP money attendant name.");
  }
  const signature = { name, consent: row.snapshot.signingConsent, signedAt: now, userAgent: userAgent.slice(0, 500), method: "typed-name-private-link",
    ...(row.snapshot.signatureMode === "on-site-three-signatures" ? {representativeOneConsent:true, representativeTwoConsent:secondRepresentativeSigned} : {}) };
  const recordHash = hash(JSON.stringify({ id: row.id, snapshot: row.snapshot, adminAnswers: row.admin_answers, clientAnswers: answers, signature }));
  return { client_answers: answers, signature, record_hash: recordHash, completed_at: now, updated_at: now, status: "Completed" };
}
export const publicAgreement = (row: any) => ({
  id: row.id, snapshot: withCurrentDraftFields(row).snapshot, clientName: row.client_name, clientEmail: row.client_email,
  adminAnswers: row.admin_answers, clientAnswers: row.client_answers, status: row.status,
  sentAt: row.sent_at, completedAt: row.completed_at, signature: row.signature,
  recordHash: row.record_hash, expiresAt: row.expires_at, updatedAt: row.updated_at,
});
