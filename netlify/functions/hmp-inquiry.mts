import type { Config, Context } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  conversationToken,
  newNonce,
  tokenHash,
} from "./_conversation-security.mts";

const requiredFields = [
  "name",
  "email",
  "phone",
  "celebration-date",
  "service",
  "location",
  "start-time",
  "end-time",
  "vendor-exit-time",
  "guest-count",
  "parking-fee",
  "celebration-type",
];

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const escapeHtml = (value: unknown) =>
  text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const displayText = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return text(value);
};

const escapeDisplayHtml = (value: unknown) =>
  escapeHtml(displayText(value)).replaceAll("\n", "<br>");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sendEmail = async (
  apiKey: string,
  message: Record<string, unknown>,
) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    console.error("Inquiry email delivery failed", response.status, result);
    throw new Error(`Email delivery failed with status ${response.status}`);
  }

  return response.json().catch(() => ({}));
};

const sendInquiryEmails = async (
  row: Record<string, unknown>,
  conversationUrl: string,
) => {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const fromEmail =
    Netlify.env.get("HMP_INQUIRY_FROM_EMAIL") ||
    Netlify.env.get("HMP_INVOICE_FROM_EMAIL") ||
    "HMP Luxury Event Services <inquiries@hmpeds.com>";
  const adminEmail =
    Netlify.env.get("HMP_INQUIRY_ADMIN_EMAIL") || "info@hmpeds.com";
  const replyTo = "info@hmpeds.com";

  if (!apiKey || !fromEmail) {
    console.error("Inquiry email delivery is not configured");
    return { admin: false, client: false };
  }

  const clientName = escapeHtml(row.client_name);
  const clientEmail = text(row.email).toLowerCase();
  const service = escapeHtml(row.service);
  const celebrationDate = escapeHtml(row.celebration_date || "Not provided");
  const location = escapeHtml(row.location);
  const phone = escapeHtml(row.phone || "Not provided");
  const guestCount = escapeDisplayHtml(row.guest_count ?? "Not provided");
  const celebrationType = escapeHtml(row.celebration_type);
  const additionalInformation = escapeHtml(
    row.additional_information || "None provided",
  );
  const submitted = (row.raw_payload || {}) as Record<string, unknown>;
  const schedule = [
    `Start: ${text(submitted["start-time"]) || "Not provided"}`,
    `End: ${text(submitted["end-time"]) || "Not provided"}`,
    `Vendor exit: ${text(submitted["vendor-exit-time"]) || "Not provided"}`,
  ]
    .map(escapeHtml)
    .join("<br>");
  const serviceDetails = escapeHtml(
    submitted["multiple-services-detail"] ||
      submitted["other-service-detail"] ||
      "Not provided",
  );
  const inquiryCopyRows = [
    ["Client name", row.client_name],
    ["Email", row.email],
    ["Phone", row.phone],
    ["Preferred contact", row.preferred_contact],
    ["Service of interest", row.service],
    ["Estimated guest count", row.guest_count],
    ["Parking fee", row.parking_fee],
    ["Celebration type", row.celebration_type],
    ["First celebration date", row.celebration_date],
    ["First celebration location", row.location],
    ["First celebration start time", submitted["start-time"]],
    ["First celebration end time", submitted["end-time"]],
    ["First celebration vendor exit time", submitted["vendor-exit-time"]],
    ["Second celebration date", row.second_date],
    ["Second celebration location", submitted["second-location"]],
    ["Second celebration guest count", submitted["second-guest-count"]],
    ["Second celebration start time", submitted["second-start-time"]],
    ["Second celebration end time", submitted["second-end-time"]],
    [
      "Second celebration vendor exit time",
      submitted["second-vendor-exit-time"],
    ],
    ["How did you hear about us?", row.referral_source],
    ["Referral name or other source", row.referral_detail],
    [
      "Service details",
      submitted["multiple-services-detail"] || submitted["other-service-detail"],
    ],
    ["Additional information", row.additional_information],
  ]
    .filter(([, value]) => displayText(value))
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 12px 10px 0;color:#8b7272;width:42%;vertical-align:top;border-bottom:1px solid #eadbd6">${escapeHtml(label)}</td>
          <td style="padding:10px 0;vertical-align:top;border-bottom:1px solid #eadbd6">${escapeDisplayHtml(value)}</td>
        </tr>`,
    )
    .join("");

  const adminMessage = {
    from: fromEmail,
    to: [adminEmail],
    reply_to: clientEmail,
    subject: `New HMP inquiry — ${text(row.client_name)} · ${text(row.service)}`,
    html: `
      <div style="margin:0;background:#f8f1eb;padding:32px 16px;color:#4d3232;font-family:Arial,sans-serif">
        <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eadbd6;border-radius:20px;overflow:hidden">
          <div style="background:#734949;padding:24px 28px;color:#fff">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase">HMP Luxury Event Services</p>
            <h1 style="margin:0;font-family:Georgia,serif;font-size:30px;font-weight:500">New celebration inquiry</h1>
          </div>
          <div style="padding:28px">
            <p style="margin:0 0 22px;font-size:16px;line-height:1.6">A new website inquiry is ready in the <a href="https://hmpeds.com/admin" style="color:#9a633b">HMP admin dashboard</a>.</p>
            <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5">
              <tr><td style="padding:9px 0;color:#8b7272;width:150px">Client</td><td style="padding:9px 0"><strong>${clientName}</strong></td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Email</td><td style="padding:9px 0"><a href="mailto:${escapeHtml(clientEmail)}" style="color:#734949">${escapeHtml(clientEmail)}</a></td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Phone</td><td style="padding:9px 0">${phone}</td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Service</td><td style="padding:9px 0">${service}</td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Celebration</td><td style="padding:9px 0">${celebrationType}</td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Date</td><td style="padding:9px 0">${celebrationDate}</td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Location</td><td style="padding:9px 0">${location}</td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Schedule</td><td style="padding:9px 0">${schedule}</td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Guest count</td><td style="padding:9px 0">${guestCount}</td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Parking fee</td><td style="padding:9px 0">${escapeHtml(row.parking_fee || "Not provided")}</td></tr>
              <tr><td style="padding:9px 0;color:#8b7272">Service details</td><td style="padding:9px 0">${serviceDetails}</td></tr>
            </table>
            <div style="margin-top:22px;padding:18px;background:#f8f1eb;border-radius:12px">
              <strong style="display:block;margin-bottom:8px">Additional information</strong>
              <p style="margin:0;white-space:pre-line;line-height:1.6">${additionalInformation}</p>
            </div>
            <p style="margin:24px 0 0"><a href="https://hmpeds.com/admin" style="display:inline-block;background:#b67c42;color:#fff;text-decoration:none;padding:13px 20px;border-radius:999px;font-weight:bold">Open admin dashboard</a></p>
          </div>
        </div>
      </div>`,
  };

  const clientMessage = {
    from: fromEmail,
    to: [clientEmail],
    reply_to: replyTo,
    subject: "Your HMP inquiry confirmation and copy",
    html: `
      <div style="margin:0;background:#f8f1eb;padding:32px 16px;color:#4d3232;font-family:Arial,sans-serif">
        <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #eadbd6;border-radius:20px;overflow:hidden">
          <div style="background:#734949;padding:28px;color:#fff">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;text-transform:uppercase">HMP Luxury Event Services</p>
            <h1 style="margin:0;font-family:Georgia,serif;font-size:32px;font-weight:500">Your inquiry is received.</h1>
          </div>
          <div style="padding:30px 28px;font-size:16px;line-height:1.7">
            <p style="margin-top:0">Hello ${clientName},</p>
            <p>Thank you for considering HMP for your celebration. We received your request for <strong>${service}</strong> and will get back to you within 48 hours.</p>
            <div style="margin:24px 0;padding:18px;background:#f8f1eb;border-radius:12px">
              <p style="margin:0 0 10px;color:#8b7272;font-size:12px;letter-spacing:1.5px;text-transform:uppercase">Copy of your inquiry</p>
              <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5">
                ${inquiryCopyRows}
              </table>
            </div>
            <p style="margin:24px 0"><a href="${escapeHtml(conversationUrl)}" style="display:inline-block;background:#b67c42;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:bold">Talk with a representative</a></p>
            <p style="margin:-10px 0 24px;color:#8b7272;font-size:13px">Use this private link to send messages directly to the HMP team. Please do not forward it.</p>
            <p>If you need to add anything, reply directly to this email or contact us at <a href="mailto:${replyTo}" style="color:#9a633b">${replyTo}</a> or <a href="tel:+13014710990" style="color:#9a633b">301-471-0990</a>.</p>
            <p style="margin-bottom:0">Warmly,<br><strong>HMP Luxury Event Services</strong><br><span style="color:#8b7272">Elevating Events. Defining Luxury.</span></p>
          </div>
        </div>
      </div>`,
  };

  const [adminResult, clientResult] = await Promise.allSettled([
    sendEmail(apiKey, adminMessage),
    emailPattern.test(clientEmail)
      ? sendEmail(apiKey, clientMessage)
      : Promise.reject(new Error("Invalid client email")),
  ]);

  return {
    admin: adminResult.status === "fulfilled",
    client: clientResult.status === "fulfilled",
  };
};

const optionalDate = (value: unknown) => {
  const candidate = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  const parts = candidate.match(/^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s*$/);
  if (!parts) return null;
  const [, month, day, year] = parts;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  )
    return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

const optionalInteger = (value: unknown) => {
  const candidate = Number.parseInt(text(value), 10);
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
};

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

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  if (text(payload["bot-field"])) return json({ ok: true });

  const missing = requiredFields.filter((field) => !text(payload[field]));
  if (missing.length) {
    return json(
      { ok: false, error: "Required inquiry details are missing" },
      400,
    );
  }

  const client = getDatabase();
  if (!client) {
    return json(
      { ok: false, error: "Inquiry destination is unavailable" },
      503,
    );
  }

  const submissionId =
    text(payload["submission-id"]) || crypto.randomUUID();
  const rawPayload = { ...payload };
  delete rawPayload["bot-field"];
  delete rawPayload["form-name"];

  const row = {
    submission_id: submissionId,
    received_at: new Date().toISOString(),
    status: "New",
    priority: "Normal",
    client_name: text(payload.name),
    email: text(payload.email),
    phone: text(payload.phone) || null,
    preferred_contact: text(payload["contact-method"]) || null,
    celebration_date: optionalDate(payload["celebration-date"]),
    second_date: optionalDate(payload["second-date"]),
    service: text(payload.service),
    location: text(payload.location),
    start_time: text(payload["start-time"]) || null,
    end_time: text(payload["end-time"]) || null,
    guest_count: optionalInteger(payload["guest-count"]),
    parking_fee: text(payload["parking-fee"]) || null,
    celebration_type: text(payload["celebration-type"]),
    referral_source: text(payload["referral-source"]) || null,
    referral_detail: text(payload["source-detail"]) || null,
    additional_information:
      text(payload["additional-information"]) || null,
    follow_up_date: null,
    owner: null,
    internal_notes: null,
    source: "Website",
    raw_payload: rawPayload,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("hmp_admin_inquiries")
    .upsert(row, { onConflict: "submission_id", ignoreDuplicates: true })
    .select("submission_id")
    .maybeSingle();

  if (error) {
    console.error("Supabase inquiry write failed", error.code);
    return json({ ok: false, error: "Inquiry could not be recorded" }, 502);
  }

  if (!data) return json({ ok: true, duplicate: true });

  const conversationId = crypto.randomUUID();
  const nonce = newNonce();
  const token = conversationToken(conversationId, nonce);
  const { error: conversationError } = await client
    .from("hmp_client_conversations")
    .insert({
      id: conversationId,
      inquiry_id: submissionId,
      access_token_hash: tokenHash(token),
      token_nonce: nonce,
      token_expires_at: new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
  if (conversationError) {
    console.error("Secure conversation creation failed", conversationError.code);
    return json(
      { ok: false, error: "Inquiry was received, but messaging setup failed" },
      502,
    );
  }

  const conversationUrl = `https://hmpeds.com/conversation#token=${token}`;
  const emails = await sendInquiryEmails(row, conversationUrl);
  return json({ ok: true, emails, clientCopy: "full" });
};

export const config: Config = {
  path: "/api/hmp-inquiry",
};
