import type { Config } from "@netlify/functions";
import { getUser } from "./_admin-verification.mts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSameOriginMutation, conversationToken, newNonce, tokenHash } from "./_conversation-security.mts";
import { manualInquiryRecord } from "./_manual-inquiry.mts";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

const allowedEmails = () =>
  (Netlify.env.get("HMP_ADMIN_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

let database: SupabaseClient | null = null;

const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return null;
  database = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return database;
};

export const normalizeInquiry = (record: Record<string, unknown>) => {
  const raw = record.raw_payload && typeof record.raw_payload === "object" && !Array.isArray(record.raw_payload)
    ? record.raw_payload as Record<string, unknown> : {};
  // Only return known client answers, never the unrestricted raw payload.
  const answer = (key: string) => typeof raw[key] === "string" ? (raw[key] as string).trim()
    : typeof raw[key] === "number" && Number.isFinite(raw[key]) ? raw[key] : "";
  return {
  id: record.submission_id || "",
  receivedAt: record.received_at || "",
  status: record.status || "New",
  priority: record.priority || "Normal",
  name: record.client_name || "",
  email: record.email || "",
  phone: record.phone || "",
  contactMethod: record.preferred_contact || "",
  celebrationDate: record.celebration_date || "",
  secondDate: record.second_date || answer("second-date"),
  service: record.service || "",
  location: record.location || "",
  startTime: record.start_time || answer("start-time"),
  endTime: record.end_time || answer("end-time"),
  vendorExitTime: answer("vendor-exit-time"),
  secondLocation: answer("second-location"),
  secondGuestCount: answer("second-guest-count"),
  secondStartTime: answer("second-start-time"),
  secondEndTime: answer("second-end-time"),
  secondVendorExitTime: answer("second-vendor-exit-time"),
  serviceOption: answer("service-option"),
  multipleServicesDetail: answer("multiple-services-detail"),
  otherServiceDetail: answer("other-service-detail"),
  guestCount: record.guest_count ?? "",
  parkingFee: record.parking_fee || "",
  celebrationType: record.celebration_type || "",
  referralSource: record.referral_source || "",
  sourceDetail: record.referral_detail || "",
  additionalInformation: record.additional_information || "",
  followUpDate: record.follow_up_date || "",
  owner: record.owner || "",
  internalNotes: record.internal_notes || "",
  notesVersion: record.updated_at || null,
  source: record.source || "Website",
  };
};

const statuses = new Set(["New", "Contacted", "Quoted", "Booked", "Closed", "Archived"]);
const priorities = new Set(["Low", "Normal", "High", "Urgent"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const cleanText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

// Booking never renews a link, resets a PIN, or sends an unsolicited email.
// Ignore conflicts so simultaneous saves cannot replace an existing hub.
export const ensureBookedHub = async (client: SupabaseClient, inquiryId: string) => {
  const read = () => client.from("hmp_client_conversations").select("id")
    .eq("inquiry_id", inquiryId).maybeSingle();
  const existing = await read();
  if (existing.error) throw new Error("Hub lookup failed");
  if (existing.data) return existing.data.id;
  const id = crypto.randomUUID(), nonce = newNonce();
  const { error } = await client.from("hmp_client_conversations").upsert({
    id, inquiry_id: inquiryId, token_nonce: nonce,
    access_token_hash: tokenHash(conversationToken(id, nonce)),
    token_expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
  }, { onConflict: "inquiry_id", ignoreDuplicates: true });
  if (error) throw new Error("Hub creation failed");
  const saved = await read();
  if (saved.error || !saved.data) throw new Error("Hub verification failed");
  return saved.data.id;
};

export const createDashboardHandler = ({ getUserFn = getUser, databaseFactory = getDatabase } = {}) => async (request: Request) => {
  const user = await getUserFn(request);
  const email = user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const client = databaseFactory();
  if (!client) return json({ error: "Dashboard data is unavailable" }, 503);

  if (request.method === "POST") {
    if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
    let row: ReturnType<typeof manualInquiryRecord>;
    try {
      const body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid inquiry.");
      row = manualInquiryRecord(body, email);
    } catch (cause) {
      return json({ error: cause instanceof Error ? cause.message : "Invalid inquiry." }, 400);
    }
    // A stable form ID makes retries safe without overwriting a saved inquiry.
    const { error: insertError } = await client.from("hmp_admin_inquiries")
      .upsert(row, { onConflict: "submission_id", ignoreDuplicates: true });
    if (insertError) {
      console.error("Manual inquiry creation failed", insertError.code);
      return json({ error: "Inquiry could not be saved. Please try again." }, 502);
    }
    const { data, error: readError } = await client.from("hmp_admin_inquiries")
      .select("*").eq("submission_id", row.submission_id).single();
    if (readError) return json({ error: "Inquiry was saved, but could not be loaded. Please try again." }, 502);
    return json({ ok: true, inquiry: normalizeInquiry(data) }, 201);
  }

  if (request.method === "PATCH") {
    if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
    } catch {
      return json({ error: "Invalid request" }, 400);
    }

    const id = cleanText(body.id, 36);
    if (!uuidPattern.test(id)) return json({ error: "Invalid inquiry" }, 400);
    if (body.action === "save-notes") {
      if (typeof body.internalNotes !== "string" || body.internalNotes.length > 5000)
        return json({ error: "Notes must be text, up to 5,000 characters." }, 400);
      if (body.expectedVersion !== null && (typeof body.expectedVersion !== "string" ||
          body.expectedVersion.length > 40 || !Number.isFinite(Date.parse(body.expectedVersion))))
        return json({ error: "Reload the client hub before saving notes." }, 400);
      let query = client.from("hmp_admin_inquiries").update({
        internal_notes: body.internalNotes.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq("submission_id", id);
      // Compare-and-swap: never replace a colleague's newer inquiry/notes edit.
      query = body.expectedVersion === null ? query.is("updated_at", null) : query.eq("updated_at", body.expectedVersion);
      const { data, error } = await query.select("*").maybeSingle();
      if (error) return json({ error: "Notes could not be saved. Your changes are still here; please try again." }, 502);
      if (!data) return json({ error: "This inquiry changed since you opened it. Copy your notes, then reload saved notes before merging your changes." }, 409);
      return json({ ok: true, inquiry: normalizeInquiry(data) });
    }
    if (body.action !== undefined) {
      const actions: Record<string, string> = { archive: "Archived", delete: "Deleted", restore: "New" };
      const action = cleanText(body.action, 20);
      const expectedStatus = cleanText(body.expectedStatus, 24);
      if (!Object.hasOwn(actions, action) || ![...statuses, "Deleted"].includes(expectedStatus)) return json({ error: "Invalid inquiry action" }, 400);
      if ((action === "restore" && !["Archived", "Deleted"].includes(expectedStatus)) ||
          (action === "archive" && ["Archived", "Deleted"].includes(expectedStatus)) ||
          (action === "delete" && expectedStatus === "Deleted")) return json({ error: "This action is not available for the current status" }, 409);
      // Change only the status. Preserve the inquiry, related documents/messages,
      // and all private notes; never physically delete the row or cascade data.
      const { data, error } = await client.from("hmp_admin_inquiries")
        .update({ status: actions[action], updated_at: new Date().toISOString() })
        .eq("submission_id", id).eq("status", expectedStatus).select("*").maybeSingle();
      if (error) return json({ error: "Inquiry could not be moved. Please try again." }, 502);
      if (!data) return json({ error: "This inquiry changed or is unavailable. Refresh before trying again." }, 409);
      return json({ ok: true, inquiry: normalizeInquiry(data) });
    }
    const status = cleanText(body.status, 24);
    const priority = cleanText(body.priority, 16);
    const followUpDate = cleanText(body.followUpDate, 10);
    const owner = cleanText(body.owner, 100);
    const internalNotes = cleanText(body.internalNotes, 5000);

    if (!statuses.has(status)) return json({ error: "Invalid status" }, 400);
    if (!priorities.has(priority)) return json({ error: "Invalid priority" }, 400);
    if (followUpDate && !datePattern.test(followUpDate)) {
      return json({ error: "Invalid follow-up date" }, 400);
    }

    const { data, error } = await client
      .from("hmp_admin_inquiries")
      .update({
        status,
        priority,
        follow_up_date: followUpDate || null,
        owner: owner || null,
        internal_notes: internalNotes || null,
        updated_at: new Date().toISOString(),
      })
      .eq("submission_id", id)
      .select("*")
      .single();

    if (error) {
      console.error("Supabase inquiry update failed", error.code);
      return json({ error: error.code === "PGRST116" ? "Inquiry not found" : "Changes could not be saved" }, error.code === "PGRST116" ? 404 : 502);
    }

    let conversationId: string | undefined;
    let hubWarning: string | undefined;
    if (status === "Booked") {
      try { conversationId = await ensureBookedHub(client, id); }
      catch {
        hubWarning = "Booking saved, but the client hub could not be prepared. Press Save again to retry; existing client links are unchanged.";
      }
    }
    return json({ ok: true, inquiry: normalizeInquiry(data), conversationId, hubWarning });
  }

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const { data, error } = await client
    .from("hmp_admin_inquiries")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("Supabase inquiry read failed", error.code);
    return json({ error: "Dashboard data is unavailable" }, 502);
  }

  return json({
    inquiries: (data || []).map((record) => normalizeInquiry(record)),
    viewer: { email: user.email, name: user.name || "HMP Admin" },
    updatedAt: new Date().toISOString(),
  });
};

export default createDashboardHandler();

export const config: Config = {
  path: "/api/hmp-dashboard",
};
