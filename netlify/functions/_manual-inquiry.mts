const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

export function manualInquiryRecord(body: Record<string, unknown>, owner: string) {
  const id = text(body.id, 36);
  const name = text(body.name, 200);
  const email = text(body.email, 254).toLowerCase();
  const eventDate = text(body.eventDate, 10);
  const guestCount = body.guestCount === "" || body.guestCount == null ? null : Number(body.guestCount);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new Error("Please reopen the inquiry form and try again.");
  if (!name) throw new Error("Client name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid client email.");
  if (eventDate && (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
      !Number.isFinite(Date.parse(eventDate)) || new Date(eventDate).toISOString().slice(0, 10) !== eventDate))
    throw new Error("Enter a valid event date.");
  if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 0 || guestCount > 100000))
    throw new Error("Guest count must be a whole number between 0 and 100,000.");
  return {
    submission_id: id,
    client_name: name,
    email,
    phone: text(body.phone, 50) || null,
    service: text(body.service, 200) || "To be confirmed",
    celebration_type: text(body.eventType, 200) || "To be confirmed",
    celebration_date: eventDate || null,
    location: text(body.location, 500) || "To be confirmed",
    guest_count: guestCount,
    additional_information: text(body.details, 5000) || null,
    source: "Manual",
    owner,
    raw_payload: { entered_by: owner },
  };
}
