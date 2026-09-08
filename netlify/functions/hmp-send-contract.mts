import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const allowedEmails = () => (Netlify.env.get("HMP_ADMIN_EMAILS") || "")
  .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
let database: SupabaseClient | null = null;
const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return null;
  database = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return database;
};
const escapeHTML = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
const multiline = (value: unknown) => escapeHTML(value).replace(/\n/g, "<br>");
const money = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const date = (value: unknown) => {
  if (!value) return "Not specified";
  const parsed = new Date(`${String(value)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(parsed);
};
const section = (title: string, copy: unknown) => copy ? `<div style="margin-top:25px"><p style="margin:0 0 7px;color:#b67c42;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">${title}</p><div style="line-height:1.7;color:#2e2022">${multiline(copy)}</div></div>` : "";

const renderEmail = (contract: Record<string, any>) => `<!doctype html><html><head><style>@import url('https://fonts.googleapis.com/css2?family=Droid+Serif:wght@400;700&display=swap');</style></head><body style="margin:0;background:#f6efea;font-family:'Droid Serif',Georgia,serif;color:#2e2022">
  <div style="max-width:760px;margin:0 auto;padding:28px 14px">
    <div style="overflow:hidden;border:1px solid #e6d7d2;border-radius:18px;background:#fffaf5">
      <div style="padding:34px;background:#5f3f41;color:#fff">
        <img src="https://hmpeds.com/assets/brand/hmp-logo-header-2026.png" width="180" alt="HMP Luxury Event Services" style="display:block;border-radius:12px;background:#fffaf5">
        <p style="margin:28px 0 6px;color:#e5b980;font-size:11px;letter-spacing:2px;text-transform:uppercase">Event Services Agreement</p>
        <h1 style="margin:0;font-size:34px">${escapeHTML(contract.contract_number)}</h1>
      </div>
      <div style="padding:34px">
        <p style="margin:0 0 8px;color:#756467;font-size:11px;letter-spacing:1px;text-transform:uppercase">Prepared for</p>
        <h2 style="margin:0 0 7px;font-size:30px">${escapeHTML(contract.client_name)}</h2>
        <p style="margin:0;color:#756467;line-height:1.6">Effective date: ${date(contract.effective_date)}<br>Event: ${escapeHTML(contract.event_name || "Not specified")}<br>Event date: ${date(contract.event_date)}<br>Location: ${escapeHTML(contract.event_location || "Not specified")}</p>
        ${section("Selected services", contract.services)}
        ${section("Scope of services", contract.scope_of_work)}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;border-collapse:collapse;background:#eadbd7;border-radius:12px">
          <tr><td style="padding:16px;color:#756467">Total agreement value</td><td align="right" style="padding:16px;font-size:20px;font-weight:700">${money(contract.total_amount)}</td></tr>
          <tr><td style="padding:0 16px 16px;color:#756467">Retainer</td><td align="right" style="padding:0 16px 16px;font-weight:700">${money(contract.retainer_amount)}</td></tr>
        </table>
        ${section("Payment terms", contract.payment_terms)}
        ${section("Cancellation and rescheduling", contract.cancellation_terms)}
        ${section("Additional terms", contract.additional_terms)}
        <div style="margin-top:30px;padding-top:22px;border-top:1px solid #5f3f41">
          <p style="margin:0 0 22px;line-height:1.65">By signing, both parties acknowledge that they reviewed this agreement and accept the services and terms stated above.</p>
          <table role="presentation" width="100%"><tr>
            <td width="48%" valign="top" style="padding-right:15px;border-top:1px solid #756467"><p style="margin:9px 0 0"><strong>${escapeHTML(contract.hmp_signature_name || "HMP Luxury Event Services")}</strong><br><span style="color:#756467">HMP representative${contract.hmp_signed_at ? ` · ${date(contract.hmp_signed_at)}` : ""}</span></p></td>
            <td width="48%" valign="top" style="padding-left:15px;border-top:1px solid #756467"><p style="margin:9px 0 0"><strong>${escapeHTML(contract.client_signature_name || "Client signature")}</strong><br><span style="color:#756467">Client${contract.client_signed_at ? ` · ${date(contract.client_signed_at)}` : ""}</span></p></td>
          </tr></table>
        </div>
        <p style="margin:28px 0 0;color:#756467;font-size:12px">Please review this agreement and reply to this email with any questions. Electronic signature collection is not enabled in this version.</p>
      </div>
      <div style="padding:22px 34px;background:#5f3f41;color:#eadbd7;font-size:12px">HMP Luxury Event Services &nbsp; | &nbsp; info@hmpeds.com &nbsp; | &nbsp; 301-471-0990</div>
    </div>
  </div>
</body></html>`;

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const user = await getUser();
  const email = user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) return json({ error: "Unauthorized" }, 401);
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  const fromEmail = Netlify.env.get("HMP_CONTRACT_FROM_EMAIL") || Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
  if (!resendKey || !fromEmail) return json({ error: "Email delivery is not configured yet", code: "EMAIL_NOT_CONFIGURED" }, 503);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const id = typeof body.id === "string" ? body.id : "";
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) return json({ error: "Invalid contract" }, 400);
  const client = getDatabase();
  if (!client) return json({ error: "Contract data is unavailable" }, 503);
  const { data: contract, error: readError } = await client.from("hmp_admin_contracts").select("*").eq("id", id).single();
  if (readError || !contract) return json({ error: "Contract not found" }, 404);
  const recipient = typeof body.recipient === "string" ? body.recipient.trim().toLowerCase() : contract.client_email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return json({ error: "A valid recipient email is required" }, 400);
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
      ...(uuidPattern.test(requestId) ? { "Idempotency-Key": `hmp-contract/${id}/${requestId}` } : {}),
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [recipient],
      reply_to: Netlify.env.get("HMP_CONTRACT_REPLY_TO") || Netlify.env.get("HMP_INVOICE_REPLY_TO") || "info@hmpeds.com",
      subject: `Contract ${contract.contract_number} from HMP Luxury Event Services`,
      html: renderEmail(contract),
    }),
  });
  const emailResult = await emailResponse.json().catch(() => ({}));
  if (!emailResponse.ok) {
    console.error("Contract email delivery failed", emailResponse.status);
    return json({ error: "Contract email could not be sent" }, 502);
  }
  const sentAt = new Date().toISOString();
  const { data: updated, error: updateError } = await client.from("hmp_admin_contracts").update({
    status: "Sent", sent_at: sentAt, sent_to: recipient, email_message_id: emailResult.id || null, updated_at: sentAt,
  }).eq("id", id).select("*").single();
  if (updateError) {
    console.error("Contract sent-status update failed", updateError.code);
    return json({ error: "Email sent, but contract status could not be updated" }, 502);
  }
  return json({ ok: true, contract: updated });
};

export const config: Config = { path: "/api/hmp-contracts/send" };
