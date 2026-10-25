// Same-browser, short-lived drafts. Never persist a private link or signing evidence.
const prefix = "hmp-money-bank-draft-v1:";
const maxAge = 24 * 60 * 60 * 1000;
const excluded = new Set(["representativeOneSignature", "representativeTwoSignature", "representativeOneDate", "representativeTwoDate", "attendantDate", "receivedInitials", "reconciledInitials"]);
export const draftFields = snapshot => snapshot.clientFields.filter(field => !excluded.has(field.id) && !/signature|consent/i.test(field.id));
const eligible = agreement => agreement?.snapshot?.id === "money-bank-verification" && agreement.status === "Sent";
export async function draftContext(agreement, token, subtle = globalThis.crypto.subtle) {
  if (!eligible(agreement) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const digest = async value => Array.from(new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2,"0")).join("");
  return {key:prefix + await digest(token + ":" + agreement.id), fingerprint:await digest(JSON.stringify([agreement.id, agreement.snapshot, agreement.adminAnswers])), agreement};
}
function assertCurrent(context, now) {
  if (!context || !eligible(context.agreement) || !(Date.parse(context.agreement.expiresAt) > now)) throw new Error("This form is no longer available for drafts. Reopen its current HMP link.");
}
function cleanValues(snapshot, values) {
  const clean = {};
  for (const field of draftFields(snapshot)) {
    const value = values[field.id];
    if (typeof value !== "string") continue;
    if (value.length > 5000) throw new Error("A draft field is too long. Shorten it before saving.");
    clean[field.id] = value;
  }
  return clean;
}
export function saveDraft(storage, context, values, now = Date.now()) {
  assertCurrent(context, now);
  const record = {fingerprint:context.fingerprint, savedAt:now, expiresAt:Math.min(now + maxAge, Date.parse(context.agreement.expiresAt)), values:cleanValues(context.agreement.snapshot, values)};
  const encoded = JSON.stringify(record);
  if (encoded.length > 50000) throw new Error("This draft is too large to save.");
  storage.setItem(context.key, encoded);
  if (storage.getItem(context.key) !== encoded) throw new Error("The browser could not confirm your draft was saved.");
  return record;
}
export function readDraft(storage, context, now = Date.now()) {
  assertCurrent(context, now);
  const encoded = storage.getItem(context.key);
  if (!encoded) return null;
  let record;
  try { record = JSON.parse(encoded); } catch { throw new Error("The saved draft cannot be read. Your current entries are unchanged."); }
  if (encoded.length > 50000 || record.fingerprint !== context.fingerprint || !Number.isFinite(record.savedAt) || record.savedAt > now || !(record.expiresAt > now) || record.expiresAt > Math.min(record.savedAt + maxAge, Date.parse(context.agreement.expiresAt))) {
    storage.removeItem(context.key);
    return null;
  }
  return {...record, values:cleanValues(context.agreement.snapshot, record.values || {})};
}
export function clearDraft(storage, context) { if (context) storage.removeItem(context.key); }
