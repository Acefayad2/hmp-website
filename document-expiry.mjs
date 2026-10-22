// Calendar selections expire at the end of that day in HMP's business timezone.
export const expiryZone = "America/New_York";
export function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: expiryZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = type => parts.find(part => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function expiryDateAfter(days, now = new Date()) {
  const date = new Date(`${businessDate(now)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function linkExpiration(value, now = new Date()) {
  const day = typeof value === "string" ? value : "";
  const parsed = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== day
    || day < businessDate(now) || day > expiryDateAfter(30, now)) {
    throw new Error("Choose a link expiration date from today through the next 30 days (Eastern time).");
  }
  // Next midnight, using the offset on the selected date (including DST changes).
  const offset = new Intl.DateTimeFormat("en-US", {timeZone: expiryZone, timeZoneName: "longOffset"}).formatToParts(parsed).find(part => part.type === "timeZoneName").value.replace("GMT", "");
  const end = new Date(`${day}T23:59:59.999${offset}`);
  return end.toISOString();
}
export const expiryLabel = value => new Intl.DateTimeFormat("en-US", {timeZone: expiryZone, dateStyle: "long", timeStyle: "short"}).format(new Date(value)) + " Eastern time";
export const expired = (value, now = Date.now()) => Boolean(value) && !(Date.parse(value) > now);

// Run after revision selection: never fall back to an older, unexpired copy.
export function clientMessageAccess(message, now = Date.now()) {
  let proposal;
  if (message.sender === "admin" && message.body?.startsWith("HMP_PROPOSAL_V1:")) {
    try { proposal = JSON.parse(message.body.slice(16)); } catch { /* Not a proposal. */ }
  }
  const expiresAt = message.document?.expiresAt || proposal?.linkExpiresAt;
  if (!expired(expiresAt, now)) return message;
  return {...message, body: "", attachments: [], document: {
    kind: message.document?.kind || "proposal", id: message.document?.id || message.id,
    expired: true, expiresAt,
  }};
}
