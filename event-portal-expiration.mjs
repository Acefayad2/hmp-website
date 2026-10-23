/** Shared event access closes 15 days after the event ends. No records are deleted. */
export function eventPortalDeadline(event = {}) {
  let value = event.endDate || event.date;
  if (!value) return null; // An unscheduled inquiry keeps its existing link deadline.
  // Older Money Table events store dates as "October 16, 2026".
  const legacy = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/i.exec(value);
  if (legacy) {
    const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    value = `${legacy[3]}-${String(months.indexOf(legacy[1].toLowerCase()) + 1).padStart(2,"0")}-${legacy[2].padStart(2,"0")}`;
  }
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (dayOnly) {
    const day = new Date(value + "T12:00:00Z");
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) return 0;
    day.setUTCDate(day.getUTCDate() + 15);
    const date = day.toISOString().slice(0, 10);
    try {
      const offset = new Intl.DateTimeFormat("en-US", {timeZone: event.timeZone || "America/New_York", timeZoneName:"longOffset"})
        .formatToParts(day).find(part => part.type === "timeZoneName").value.replace("GMT", "") || "+00:00";
      return Date.parse(date + "T23:59:59.999" + offset);
    } catch { return 0; }
  }
  // Stored event instants must include a zone, never the server's local timezone.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return 0;
  const end = Date.parse(value);
  return Number.isFinite(end) ? end + (event.endDate ? 0 : 6 * 3600000) + 15 * 86400000 : 0;
}
export function eventPortalExpired(event, now = Date.now()) {
  const deadline = eventPortalDeadline(event);
  return deadline !== null && deadline <= now;
}
export function cappedPortalExpiration(event, expiresAt) {
  const deadline = eventPortalDeadline(event);
  if (deadline === null) return expiresAt;
  return new Date(Math.min(deadline, expiresAt ? Date.parse(expiresAt) : Infinity)).toISOString();
}

