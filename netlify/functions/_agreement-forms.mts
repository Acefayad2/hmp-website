import { createHash, createHmac, randomBytes } from "node:crypto";
import terms from "../../data/agreement-terms.json" with { type: "json" };
import { getAgreementTemplate, validateAnswers } from "../../agreement-schema.mjs";

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
  const source = (terms as Record<string, any>)[id];
  if (!template || !source) throw new Error("Choose an agreement template.");
  return { ...template, ...source, signingConsent };
};
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
  if (body.consent !== true) throw new Error("Please consent to electronic signing and accept the agreement.");
  const name = typeof body.signatureName === "string" ? body.signatureName.trim() : "";
  if (name.length < 2 || name.length > 200) throw new Error("Type your full name to sign.");
  const answers = validateAnswers(row.snapshot.clientFields, body.answers);
  const signature = { name, consent: row.snapshot.signingConsent, signedAt: now, userAgent: userAgent.slice(0, 500), method: "typed-name-private-link" };
  const recordHash = hash(JSON.stringify({ id: row.id, snapshot: row.snapshot, adminAnswers: row.admin_answers, clientAnswers: answers, signature }));
  return { client_answers: answers, signature, record_hash: recordHash, completed_at: now, updated_at: now, status: "Completed" };
}
export const publicAgreement = (row: any) => ({
  id: row.id, snapshot: row.snapshot, clientName: row.client_name, clientEmail: row.client_email,
  adminAnswers: row.admin_answers, clientAnswers: row.client_answers, status: row.status,
  sentAt: row.sent_at, completedAt: row.completed_at, signature: row.signature,
  recordHash: row.record_hash, expiresAt: row.expires_at, updatedAt: row.updated_at,
});
