import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSameOriginMutation } from "./_conversation-security.mts";

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

const normalizeInquiry = (record: Record<string, unknown>) => ({
  id: record.submission_id || "",
  receivedAt: record.received_at || "",
  status: record.status || "New",
  priority: record.priority || "Normal",
  name: record.client_name || "",
  email: record.email || "",
  phone: record.phone || "",
  contactMethod: record.preferred_contact || "",
  celebrationDate: record.celebration_date || "",
  secondDate: record.second_date || "",
  service: record.service || "",
  location: record.location || "",
  startTime: record.start_time || "",
  endTime: record.end_time || "",
  guestCount: record.guest_count ?? "",
  parkingFee: record.parking_fee || "",
  celebrationType: record.celebration_type || "",
  referralSource: record.referral_source || "",
  sourceDetail: record.referral_detail || "",
  additionalInformation: record.additional_information || "",
  followUpDate: record.follow_up_date || "",
  owner: record.owner || "",
  internalNotes: record.internal_notes || "",
  source: record.source || "Website",
});

const statuses = new Set(["New", "Contacted", "Quoted", "Booked", "Closed"]);
const priorities = new Set(["Low", "Normal", "High", "Urgent"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cleanText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

export default async (request: Request, _context: Context) => {
  const user = await getUser();
  const email = user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const client = getDatabase();
  if (!client) return json({ error: "Dashboard data is unavailable" }, 503);

  if (request.method === "POST") {
    if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }

    const name = cleanText(body.name, 200);
    const email = cleanText(body.email, 320).toLowerCase();
    const service = cleanText(body.service, 200);
    const celebrationDate = cleanText(body.celebrationDate, 10);
    const parsedCelebrationDate = new Date(`${celebrationDate}T00:00:00Z`);
    const guestCountInput = cleanText(body.guestCount, 8);
    const guestCount = guestCountInput ? Number(guestCountInput) : null;
    if (!name || !emailPattern.test(email) || !service) {
      return json({ error: "Enter the client's name, email, and service" }, 400);
    }
    if (celebrationDate && (!datePattern.test(celebrationDate) || Number.isNaN(parsedCelebrationDate.getTime()) || parsedCelebrationDate.toISOString().slice(0, 10) !== celebrationDate)) {
      return json({ error: "Enter a valid celebration date" }, 400);
    }
    if (guestCount !== null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 100000)) {
      return json({ error: "Guest count must be between 1 and 100,000" }, 400);
    }

    const now = new Date().toISOString();
    const { data, error } = await client
      .from("hmp_admin_inquiries")
      .insert({
        submission_id: crypto.randomUUID(),
        received_at: now,
        status: "New",
        priority: "Normal",
        client_name: name,
        email,
        phone: cleanText(body.phone, 60) || null,
        celebration_date: celebrationDate || null,
        service,
        location: cleanText(body.location, 500),
        guest_count: guestCount,
        celebration_type: cleanText(body.celebrationType, 200),
        internal_notes: cleanText(body.notes, 5000) || null,
        source: "Manual",
        raw_payload: {},
        updated_at: now,
      })
      .select("*")
      .single();
    if (error || !data) {
      console.error("Supabase manual inquiry insert failed", error?.code);
      return json({ error: "Inquiry could not be created" }, 502);
    }
    return json({ ok: true, inquiry: normalizeInquiry(data) }, 201);
  }

  if (request.method === "PATCH") {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }

    const id = cleanText(body.id, 36);
    const status = cleanText(body.status, 24);
    const priority = cleanText(body.priority, 16);
    const followUpDate = cleanText(body.followUpDate, 10);
    const owner = cleanText(body.owner, 100);
    const internalNotes = cleanText(body.internalNotes, 5000);

    if (!uuidPattern.test(id)) return json({ error: "Invalid inquiry" }, 400);
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

    return json({ ok: true, inquiry: normalizeInquiry(data) });
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

export const config: Config = {
  path: "/api/hmp-dashboard",
};
