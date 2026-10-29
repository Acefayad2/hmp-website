// Shared unfinished Money Bank details. Signing evidence is never a draft field.
const signingFields = new Set(["representativeOneDate", "representativeTwoDate", "attendantDate"]);
export const progressFields = snapshot => snapshot.clientFields.filter(field => !signingFields.has(field.id) && !/signature|consent/i.test(field.id));
export function cleanBankProgress(snapshot, values) {
  if (snapshot?.id !== "money-bank-verification" || !values || typeof values !== "object" || Array.isArray(values)) throw new Error("Choose a Money Bank Verification form to save progress.");
  const clean = {};
  for (const field of progressFields(snapshot)) {
    const value = values[field.id];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > 5000) throw new Error(`${field.label}: enter no more than 5,000 characters.`);
    clean[field.id] = value;
  }
  if (JSON.stringify(clean).length > 50000) throw new Error("This draft is too large. Shorten the entries before saving.");
  return clean;
}
