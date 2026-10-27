import { createHash, createHmac, randomBytes } from "node:crypto";
import terms from "../../data/agreement-terms.json" with { type: "json" };
import { getAgreementTemplate, newAgreementSnapshot, moneyTablePaymentAmounts, requiresSecondRepresentative, secondRepresentativeFields, validateAnswers, agreementTextIssues, validationError } from "../../agreement-schema.mjs";
import { replaceFormattedPage, validatePageFormatting } from "../../agreement-formatting.mjs";
import { validateSignatureDrawing } from "../../signature-pad.mjs";

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
  return {...newAgreementSnapshot(template,source), signingConsent};
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
  if (row.status !== "Draft" || !["money-collecting", "money-collecting-changing"].includes(snapshot.id)) return row;
  const currentFields = getAgreementTemplate(snapshot.id).adminFields;
  const fields = snapshot.adminFields.map((field: any) => field.id === "retainerPercent" ? currentFields.find((item: any) => item.id === field.id) : field);
  for (const [id,before] of [["serviceStartTime","serviceEndTime"],["retainerAmount","retainerDue"],["finalPaymentAmount","finalPaymentDue"]]) {
    if (fields.some((field: any) => field.id === id)) continue;
    const index = fields.findIndex((field: any) => field.id === before);
    fields.splice(index < 0 ? fields.length : index,0,currentFields.find((field: any) => field.id === id));
  }
  return {...row, snapshot:{...snapshot, adminFields:fields}, admin_answers:{...row.admin_answers,...moneyTablePaymentAmounts(row.admin_answers?.serviceFee,row.admin_answers?.retainerPercent)}};
}
export function editableSnapshot(snapshot: any, body: any) {
  if (body.approvalWording !== undefined) {
    if (!["customization-approval", "led-customization"].includes(snapshot.id)) throw new Error("This template does not have customization approval choices.");
    const wording = body.approvalWording;
    for (const key of ["label", "approve", "decline"]) {
      if (typeof wording?.[key] !== "string" || !wording[key].trim() || wording[key].trim().length > 500)
        throw validationError([{field:`approval-${key}`, message:`Client approval ${key}: enter wording (maximum 500 characters).`}]);
    }
    if (wording.approve.trim() === wording.decline.trim()) throw new Error("Approval and decline choices must be different.");
    snapshot = {...snapshot, clientFields:snapshot.clientFields.map((field: any) => field.id === "customizationApproval"
      ? {...field, label:wording.label.trim(), options:[wording.approve.trim(), wording.decline.trim()]} : field)};
  }
  const title = typeof body.title === "string" ? body.title.trim() : snapshot.title;
  if (!title || title.length > 200) throw validationError([{field:"documentTitle", message:"Document title is required (maximum 200 characters)."}]);
  if (snapshot.kind === "information") {
    const description = typeof body.description === "string" ? body.description.trim() : (snapshot.description || "");
    if (description.length > 5000) throw validationError([{field:"documentDescription", message:"Form introduction must be 5,000 characters or fewer."}]);
    return {...snapshot, title, description};
  }
  const pages = body.pages === undefined ? snapshot.pages : body.pages;
  if (!Array.isArray(pages) || pages.length !== snapshot.pages.length) throw new Error(`This agreement needs ${snapshot.pages.length} pages. Reopen the draft to restore any missing pages.`);
  const issues = pages.flatMap((page: unknown, pageIndex: number) => typeof page !== "string" || !page.trim() || page.length > 15000
    ? [{pageIndex, message:`Agreement page ${pageIndex + 1}: ${typeof page !== "string" || !page.trim() ? "enter the agreement wording" : "shorten the wording to 15,000 characters or fewer"}.`}] : []);
  if (issues.length) throw validationError(issues);
  if (pages.join("").length > 85000) throw new Error("The combined agreement text exceeds 85,000 characters. Shorten the wording before saving.");
  const formatting = body.pageFormatting === undefined ? (body.pages === undefined ? snapshot.pageFormatting : undefined) : body.pageFormatting;
  if (formatting !== undefined && (!Array.isArray(formatting) || formatting.length !== pages.length)) throw new Error("Agreement formatting must match every page.");
  const {pageFormatting:previousFormatting, ...rest} = snapshot;
  return {...rest, title, pages, ...(formatting ? {pageFormatting:formatting.map((runs: unknown, i: number) => validatePageFormatting(pages[i],runs))} : {})};
}
export function issuedSnapshot(snapshot: any, adminAnswers: Record<string, string>) {
  if (!["money-collecting", "money-collecting-changing"].includes(snapshot.id)) return snapshot;
  const issues = agreementTextIssues(snapshot);
  if (issues.length) throw validationError(issues);
  const {optionalClauses = {}, ...issued} = snapshot;
  const replacements: Record<string, string> = {
    agreementDate:adminAnswers.agreementDate,
    serviceFee:`$${Number(adminAnswers.serviceFee).toFixed(2)}`,
    serviceHours:adminAnswers.serviceHours,
    retainerDue:adminAnswers.retainerDue,
    retainerClause:adminAnswers.retainerPercent ? `An initial ${adminAnswers.retainerPercent}% non-refundable retainer & a signed agreement must be secured prior to any services being performed by Vendor.` : adminAnswers.customPaymentTerms,
    retainerPayment:adminAnswers.retainerPercent ? `${adminAnswers.retainerPercent}% Non-Refundable Retainer due by: ${adminAnswers.retainerDue}` : "See custom payment terms above.",
    finalPaymentDue:adminAnswers.finalPaymentDue,
    serviceStartTime:adminAnswers.serviceStartTime,
    serviceEndTime:adminAnswers.serviceEndTime,
    cancellationDeadline:adminAnswers.cancellationDeadline,
    cancellationRefundAmount:`$${Number(adminAnswers.cancellationRefundAmount).toFixed(2)}`,
    commissionClause:adminAnswers.includeCommission === "Yes" ? optionalClauses.commissionClause : "",
    travelClause:adminAnswers.includeTravelFee === "Yes" ? optionalClauses.travelClause : "",
    grandTotalClause:adminAnswers.includeGrandTotal === "Yes" ? "The final total will be presented to the Client at the conclusion of the service." : "",
  };
  const replace = (key: string) => {
    if (typeof replacements[key] !== "string") throw new Error(`Unrecognized agreement field: ${key}`);
    return replacements[key];
  };
  const rendered = snapshot.pages.map((page: string, i: number) => replaceFormattedPage(page,snapshot.pageFormatting?.[i],replace));
  const pages = rendered.map((page: any) => page.text);
  const remaining = agreementTextIssues({...snapshot, pages});
  if (remaining.length) throw validationError(remaining);
  return {...issued, pages, ...(snapshot.pageFormatting ? {pageFormatting:rendered.map((page: any) => page.formatting)} : {})};
}
export const cleanContact = (body: any) => {
  const name = typeof body.clientName === "string" ? body.clientName.trim() : "";
  const email = typeof body.clientEmail === "string" ? body.clientEmail.trim().toLowerCase() : "";
  const issues = [];
  if (!name || name.length > 200) issues.push({field:"clientName", message:"Client name is required (maximum 200 characters)."});
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push({field:"clientEmail", message:"A valid client email is required."});
  if (issues.length) throw validationError(issues);
  return { client_name: name, client_email: email };
};
export const signingConsent = "I have reviewed this agreement and the completed details, agree to its terms, and consent to using electronic records and my typed name as my electronic signature. I can print or save a copy. To use a paper form instead, I can contact info@hmpeds.com before signing.";
export function completionPayload(row: any, body: any, userAgent = "", now = new Date().toISOString()) {
  if (row.status !== "Sent" || !row.expires_at || Date.parse(row.expires_at) <= Date.parse(now)) throw new Error("This agreement is not open for completion.");
  if (row.snapshot.kind === "information") {
    const answers = validateAnswers(row.snapshot.clientFields, body.answers);
    return {client_answers:answers, signature:null, record_hash:hash(JSON.stringify({id:row.id, snapshot:row.snapshot, answers, completedAt:now})), completed_at:now, updated_at:now, status:"Completed"};
  }
  if (body.consent !== true) throw validationError([{field:"consent", message:"Please consent to electronic signing and accept the agreement."}]);
  const name = typeof body.signatureName === "string" ? body.signatureName.trim() : "";
  if (name.length < 2 || name.length > 200) throw validationError([{field:"signatureName", message:"Type your full name to sign (2–200 characters)."}]);
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
  const drawings: Record<string, any> = {};
  if (body.signatureDrawings !== undefined) {
    if (!body.signatureDrawings || typeof body.signatureDrawings !== "object" || Array.isArray(body.signatureDrawings)) throw new Error("Invalid signature drawings.");
    const allowed = ["signatureName", ...(row.snapshot.signatureMode === "on-site-three-signatures" ? ["representativeOneSignature", ...(secondRepresentativeSigned ? ["representativeTwoSignature"] : [])] : [])];
    for (const [key,value] of Object.entries(body.signatureDrawings) as [string, any][]) {
      if (!allowed.includes(key) || !value || value.consent !== true) throw new Error("Each drawing needs its signer’s details and explicit authorization.");
      drawings[key] = {strokes:validateSignatureDrawing(value.strokes), consent:"I authorize this drawing as part of my electronic signature."};
    }
  }
  const signature = { name, consent: row.snapshot.signingConsent, signedAt: now, userAgent: userAgent.slice(0, 500), method: "typed-name-private-link",
    ...(Object.keys(drawings).length ? {drawings} : {}),
    ...(row.snapshot.signatureMode === "on-site-three-signatures" ? {representativeOneConsent:true, representativeTwoConsent:secondRepresentativeSigned} : {}) };
  const recordHash = hash(JSON.stringify({ id: row.id, snapshot: row.snapshot, adminAnswers: row.admin_answers, clientAnswers: answers, signature }));
  return { client_answers: answers, signature, record_hash: recordHash, completed_at: now, updated_at: now, status: "Completed" };
}
export const publicAgreement = (storedRow: any) => {
  const row = withCurrentDraftFields(storedRow);
  return {
    id: row.id, snapshot: row.snapshot, clientName: row.client_name, clientEmail: row.client_email,
    adminAnswers: row.admin_answers, clientAnswers: row.client_answers, status: row.status,
    sentAt: row.sent_at, completedAt: row.completed_at, signature: row.signature,
    recordHash: row.record_hash, expiresAt: row.expires_at, updatedAt: row.updated_at,
    ...(row.revision_root_id ? {revisionRootId:row.revision_root_id, legacyRevisionText:!row.prepared_snapshot && row.snapshot.kind !== "information"} : {}),
  };
};
