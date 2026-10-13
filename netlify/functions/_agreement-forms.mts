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
  if (template?.kind === "information") return {...template};
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
export const signingConsent = "I have reviewed this agreement and the completed details, agree to its terms, and consent to using electronic records and my typed or hand-drawn signature as my electronic signature. I can print or save a copy. To use a paper form instead, I can contact info@hmpeds.com before signing.";
export const informationSigningConsent = "I confirm these completed details are accurate to the best of my knowledge and consent to using my typed or hand-drawn electronic signature. I can print or save a copy. To use a paper form instead, I can contact info@hmpeds.com before signing.";
function clientSignature(row: any, body: any, userAgent: string, now: string) {
  if (body.consent !== true) throw new Error("Please consent to electronic signing before submitting.");
  const name = typeof body.signatureName === "string" ? body.signatureName.trim() : "";
  if (name.length < 2 || name.length > 200) throw new Error("Enter your full name to sign.");
  const method = body.signatureMethod ?? "typed";
  if (method !== "typed" && method !== "drawn") throw new Error("Choose a valid signature method.");
  let image: string | undefined;
  if (method === "drawn") {
    if (!String(row.snapshot.signingConsent || "").includes("hand-drawn")) throw new Error("This form only supports a typed signature. Contact HMP for a new form to draw your signature.");
    const value = typeof body.signatureImage === "string" ? body.signatureImage : "";
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || value.length > 80000) throw new Error("Draw a smaller signature and try again.");
    const bytes = Buffer.from(match[1], "base64");
    if (bytes.length < 80 || bytes.length > 60000 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || bytes.readUInt32BE(16) !== 600 || bytes.readUInt32BE(20) !== 180) throw new Error("Draw a valid signature and try again.");
    image = value;
  }
  return { name, consent: row.snapshot.signingConsent || (row.snapshot.kind === "information" ? informationSigningConsent : signingConsent),
    signedAt: now, userAgent: userAgent.slice(0, 500), method, ...(image ? { image } : {}) };
}
export function completionPayload(row: any, body: any, userAgent = "", now = new Date().toISOString()) {
  if (row.status !== "Sent" || !row.expires_at || Date.parse(row.expires_at) <= Date.parse(now)) throw new Error("This agreement is not open for completion.");
  if (row.snapshot.kind === "information") {
    const answers = validateAnswers(row.snapshot.clientFields, body.answers);
    const signature = row.snapshot.signatureRequired ? clientSignature(row, body, userAgent, now) : null;
    return {client_answers:answers, signature, record_hash:hash(JSON.stringify({id:row.id, snapshot:row.snapshot, adminAnswers:row.admin_answers, answers, signature, completedAt:now})), completed_at:now, updated_at:now, status:"Completed"};
  }
  const answers = validateAnswers(row.snapshot.clientFields, body.answers);
  const signature = clientSignature(row, body, userAgent, now);
  const recordHash = hash(JSON.stringify({ id: row.id, snapshot: row.snapshot, adminAnswers: row.admin_answers, clientAnswers: answers, signature }));
  return { client_answers: answers, signature, record_hash: recordHash, completed_at: now, updated_at: now, status: "Completed" };
}
export const publicAgreement = (row: any) => ({
  id: row.id, snapshot: row.snapshot, clientName: row.client_name, clientEmail: row.client_email,
  adminAnswers: row.admin_answers, clientAnswers: row.client_answers, status: row.status,
  sentAt: row.sent_at, completedAt: row.completed_at, signature: row.signature,
  recordHash: row.record_hash, expiresAt: row.expires_at, updatedAt: row.updated_at,
});
