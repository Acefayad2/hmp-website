import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
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

const escapeHTML = (value: unknown) =>
  String(value ?? "").replace(/[&<>'"]/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character,
  );
const money = (value: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const date = (value: unknown) => {
  if (!value) return "Not specified";
  const parsed = new Date(`${String(value)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(parsed);
};

const renderEmail = (invoice: Record<string, any>) => {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:14px 8px;border-bottom:1px solid #eadfda;color:#2e2022">${escapeHTML(item.description)}</td>
      <td style="padding:14px 8px;border-bottom:1px solid #eadfda;text-align:center;color:#756467">${escapeHTML(item.quantity)}</td>
      <td style="padding:14px 8px;border-bottom:1px solid #eadfda;text-align:right;color:#756467">${money(item.rate)}</td>
      <td style="padding:14px 8px;border-bottom:1px solid #eadfda;text-align:right;color:#2e2022;font-weight:600">${money(item.amount)}</td>
    </tr>`).join("");

  return `<!doctype html><html><head><style>@import url('https://fonts.googleapis.com/css2?family=Droid+Serif:wght@400;700&display=swap');</style></head><body style="margin:0;background:#f6efea;font-family:'Droid Serif',Georgia,serif;color:#2e2022">
    <div style="max-width:720px;margin:0 auto;padding:28px 14px">
      <div style="background:#fffaf5;border:1px solid #e6d7d2;border-radius:18px;overflow:hidden">
        <div style="padding:34px;background:#5f3f41;color:#fff">
          <img src="https://hmpeds.com/assets/brand/hmp-logo-2026.png" width="170" alt="HMP Luxury Event Services" style="display:block;border-radius:12px;background:#fffaf5">
          <p style="margin:28px 0 6px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#e5b980">Invoice</p>
          <h1 style="margin:0;font-family:Georgia,serif;font-size:38px">${escapeHTML(invoice.invoice_number)}</h1>
        </div>
        <div style="padding:34px">
          <p style="margin:0 0 8px;color:#756467;font-size:12px;text-transform:uppercase;letter-spacing:1px">Prepared for</p>
          <h2 style="margin:0 0 6px;font-family:Georgia,serif;font-size:30px">${escapeHTML(invoice.client_name)}</h2>
          <p style="margin:0;color:#756467">Issue date: ${date(invoice.issue_date)}<br>Due date: ${date(invoice.due_date)}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:30px;border-collapse:collapse">
            <thead><tr style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#756467">
              <th align="left" style="padding:10px 8px;border-bottom:1px solid #5f3f41">Service</th>
              <th style="padding:10px 8px;border-bottom:1px solid #5f3f41">Qty</th>
              <th align="right" style="padding:10px 8px;border-bottom:1px solid #5f3f41">Rate</th>
              <th align="right" style="padding:10px 8px;border-bottom:1px solid #5f3f41">Amount</th>
            </tr></thead><tbody>${itemRows}</tbody>
          </table>
          <table role="presentation" width="100%" style="margin-top:22px"><tr><td></td><td style="width:270px">
            <table role="presentation" width="100%" style="color:#756467">
              <tr><td style="padding:5px">Subtotal</td><td align="right">${money(invoice.subtotal)}</td></tr>
              <tr><td style="padding:5px">Discount</td><td align="right">-${money(invoice.discount_amount)}</td></tr>
              <tr><td style="padding:5px">Tax (${escapeHTML(invoice.tax_rate)}%)</td><td align="right">${money(invoice.tax_amount)}</td></tr>
              <tr><td style="padding:13px 5px 5px;border-top:1px solid #5f3f41;color:#2e2022;font-weight:700">Total</td><td align="right" style="padding-top:13px;border-top:1px solid #5f3f41;color:#2e2022;font-size:22px;font-weight:700">${money(invoice.total)}</td></tr>
            </table>
          </td></tr></table>
          ${invoice.notes ? `<div style="margin-top:28px;padding:18px;background:#eadbd7;border-radius:12px"><strong>Notes</strong><p style="margin:7px 0 0;white-space:pre-wrap">${escapeHTML(invoice.notes)}</p></div>` : ""}
          ${invoice.payment_terms ? `<p style="margin:24px 0 0;color:#756467"><strong style="color:#2e2022">Payment terms:</strong> ${escapeHTML(invoice.payment_terms)}</p>` : ""}
        </div>
        <div style="padding:22px 34px;background:#5f3f41;color:#eadbd7;font-size:12px">
          HMP Luxury Event Services &nbsp; | &nbsp; info@hmpeds.com &nbsp; | &nbsp; 301-471-0990
        </div>
      </div>
    </div>
  </body></html>`;
};

export default async (request: Request, _context: Context) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const user = await getUser();
  const email = user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) return json({ error: "Unauthorized" }, 401);

  const resendKey = Netlify.env.get("RESEND_API_KEY");
  const fromEmail = Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
  if (!resendKey || !fromEmail) {
    return json({ error: "Email delivery is not configured yet", code: "EMAIL_NOT_CONFIGURED" }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) return json({ error: "Invalid invoice" }, 400);

  const client = getDatabase();
  if (!client) return json({ error: "Invoice data is unavailable" }, 503);
  const { data: invoice, error: readError } = await client
    .from("hmp_admin_invoices")
    .select("*")
    .eq("id", id)
    .single();
  if (readError || !invoice) return json({ error: "Invoice not found" }, 404);

  const recipient = typeof body.recipient === "string" ? body.recipient.trim().toLowerCase() : invoice.client_email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return json({ error: "A valid recipient email is required" }, 400);
  }

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromEmail,
      to: [recipient],
      reply_to: Netlify.env.get("HMP_INVOICE_REPLY_TO") || "info@hmpeds.com",
      subject: `Invoice ${invoice.invoice_number} from HMP Luxury Event Services`,
      html: renderEmail(invoice),
    }),
  });
  const emailResult = await emailResponse.json().catch(() => ({}));
  if (!emailResponse.ok) {
    console.error("Invoice email delivery failed", emailResponse.status);
    return json({ error: "Invoice email could not be sent" }, 502);
  }

  const sentAt = new Date().toISOString();
  const { data: updated, error: updateError } = await client
    .from("hmp_admin_invoices")
    .update({
      status: "Sent",
      sent_at: sentAt,
      sent_to: recipient,
      email_message_id: emailResult.id || null,
      updated_at: sentAt,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (updateError) {
    console.error("Invoice sent-status update failed", updateError.code);
    return json({ error: "Email sent, but invoice status could not be updated" }, 502);
  }

  return json({ ok: true, invoice: updated });
};

export const config: Config = {
  path: "/api/hmp-invoices/send",
};
