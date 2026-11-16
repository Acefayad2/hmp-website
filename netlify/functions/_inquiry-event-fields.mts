const fields = {
  startTime: ["start-time", "time"],
  endTime: ["end-time", "time"],
  vendorExitTime: ["vendor-exit-time", "time"],
  serviceStartTime: ["service-start-time", "time"],
  serviceEndTime: ["service-end-time", "time"],
  secondDate: ["second-date", "date"],
  secondLocation: ["second-location", "text"],
  secondGuestCount: ["second-guest-count", "count"],
  secondStartTime: ["second-start-time", "time"],
  secondEndTime: ["second-end-time", "time"],
  secondVendorExitTime: ["second-vendor-exit-time", "time"],
  secondServiceStartTime: ["second-service-start-time", "time"],
  secondServiceEndTime: ["second-service-end-time", "time"],
  totalServiceHours: ["total-service-hours", "hours"],
} as const;

export function inquiryEventFields(body: Record<string, unknown>) {
  const result: Record<string, string> = {};
  for (const [name, [key, kind]] of Object.entries(fields)) {
    const value = body[name];
    if (value !== undefined && typeof value !== "string") throw new Error(`Invalid ${name}.`);
    const clean = (value || "").trim();
    if (kind === "time" && clean && !/^([01]\d|2[0-3]):[0-5]\d$/.test(clean)) throw new Error(`Enter a valid ${name} time.`);
    if (kind === "date" && clean && (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || !Number.isFinite(Date.parse(clean)) || new Date(clean).toISOString().slice(0, 10) !== clean)) throw new Error("Enter a valid second event date.");
    if (kind === "text" && clean.length > 500) throw new Error("Second event location is too long.");
    if (kind === "count" && clean && (!/^\d+$/.test(clean) || Number(clean) > 100000)) throw new Error("Second event guest count must be between 0 and 100,000.");
    if (kind === "hours" && clean && (!/^\d+(?:\.0|\.5)?$/.test(clean) || Number(clean) < 0.5 || Number(clean) > 240)) throw new Error("Total service hours must be between 0.5 and 240 in half-hour increments.");
    result[key] = clean;
  }
  return result;
}
