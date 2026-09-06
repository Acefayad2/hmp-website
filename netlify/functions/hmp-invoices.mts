import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const text = (value: unknown, maxLength = 500) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const number = (value: unknown, fallback = 0) => {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeInvoice = (record: Record<string, unknown>) => ({
  id: record.id || "",
  invoiceNumber: record.invoice_number || "",
  status: record.status || "Draft",
  issueDate: record.issue_date || "",
  dueDate: record.due_date || "",
  clientName: record.client_name || "",
  clientEmail: record.client_email || "",
  clientPhone: record.client_phone || "",
  billingAddress: record.billing_address || "",
  eventName: record.event_name || "",
  eventDate: record.event_date || "",
  currency: record.currency || "USD",
  items: Array.isArray(record.items) ? record.items : [],
  subtotal: number(record.subtotal),
  taxRate: number(record.tax_rate),
  taxAmount: number(record.tax_amount),
  discountAmount: number(record.discount_amount),
  total: number(record.total),
  notes: record.notes || "",
  paymentTerms: record.payment_terms || "",
  inquiryId: record.inquiry_id || "",
  sentAt: record.sent_at || "",
  sentTo: record.sent_to || "",
  createdBy: record.created_by || "",
  createdAt: record.created_at || "",
  updatedAt: record.updated_at || "",
});

const cleanPayload = (body: Record<string, unknown>) => {
  const clientName = text(body.clientName, 200);
  const clientEmail = text(body.clientEmail, 320).toLowerCase();
  const issueDate = text(body.issueDate, 10);
  const dueDate = text(body.dueDate, 10);
  const eventDate = text(body.eventDate, 10);
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const items = rawItems
    .map((rawItem) => {
      const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
      const description = text(item.description, 500);
      const quantity = Math.min(10000, Math.max(0, number(item.quantity)));
      const rate = Math.min(1000000, Math.max(0, number(item.rate)));
      return {
        id: text(item.id, 60) || crypto.randomUUID(),
        description,
        quantity,
        rate: money(rate),
        amount: money(quantity * rate),
      };
    })
    .filter((item) => item.description && item.quantity > 0);

  if (!clientName) throw new Error("Client name is required");
  if (!emailPattern.test(clientEmail)) throw new Error("A valid client email is required");
  if (!datePattern.test(issueDate)) throw new Error("A valid issue date is required");
  if (dueDate && !datePattern.test(dueDate)) throw new Error("Due date is invalid");
  if (eventDate && !datePattern.test(eventDate)) throw new Error("Event date is invalid");
  if (!items.length) throw new Error("Add at least one invoice item");

  const subtotal = money(items.reduce((sum, item) => sum + item.amount, 0));
  const discountAmount = money(Math.min(subtotal, Math.max(0, number(body.discountAmount))));
  const taxRate = money(Math.min(100, Math.max(0, number(body.taxRate))));
  const taxAmount = money((subtotal - discountAmount) * (taxRate / 100));
  const total = money(subtotal - discountAmount + taxAmount);
  const status = ["Draft", "Sent", "Paid", "Void"].includes(text(body.status, 12))
    ? text(body.status, 12)
    : "Draft";
  const inquiryId = text(body.inquiryId, 36);

  return {
    status,
    issue_date: issueDate,
    due_date: dueDate || null,
    client_name: clientName,
    client_email: clientEmail,
    client_phone: text(body.clientPhone, 60) || null,
    billing_address: text(body.billingAddress, 1000) || null,
    event_name: text(body.eventName, 250) || null,
    event_date: eventDate || null,
    currency: "USD",
    items,
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    discount_amount: discountAmount,
    total,
    notes: text(body.notes, 5000) || null,
    payment_terms: text(body.paymentTerms, 2000) || null,
    inquiry_id: inquiryId && uuidPattern.test(inquiryId) ? inquiryId : null,
    updated_at: new Date().toISOString(),
  };
};

export default async (request: Request, _context: Context) => {
  const user = await getUser();
  const email = user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const client = getDatabase();
  if (!client) return json({ error: "Invoice data is unavailable" }, 503);

  if (request.method === "GET") {
    const { data, error } = await client
      .from("hmp_admin_invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("Supabase invoice read failed", error.code);
      return json({ error: "Invoice data is unavailable" }, 502);
    }
    return json({
      invoices: (data || []).map((record) => normalizeInvoice(record)),
      emailConfigured: Boolean(
        Netlify.env.get("RESEND_API_KEY") && Netlify.env.get("HMP_INVOICE_FROM_EMAIL"),
      ),
      updatedAt: new Date().toISOString(),
    });
  }

  if (request.method === "POST" || request.method === "PATCH") {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }

    let payload: ReturnType<typeof cleanPayload>;
    try {
      payload = cleanPayload(body);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invoice details are invalid" }, 400);
    }

    if (request.method === "POST") {
      const { data, error } = await client
        .from("hmp_admin_invoices")
        .insert({ ...payload, created_by: user.email || email })
        .select("*")
        .single();
      if (error) {
        console.error("Supabase invoice create failed", error.code);
        return json({ error: "Invoice could not be created" }, 502);
      }
      return json({ ok: true, invoice: normalizeInvoice(data) }, 201);
    }

    const id = text(body.id, 36);
    if (!uuidPattern.test(id)) return json({ error: "Invalid invoice" }, 400);
    const { data, error } = await client
      .from("hmp_admin_invoices")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      console.error("Supabase invoice update failed", error.code);
      return json({ error: error.code === "PGRST116" ? "Invoice not found" : "Invoice could not be saved" }, error.code === "PGRST116" ? 404 : 502);
    }
    return json({ ok: true, invoice: normalizeInvoice(data) });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config: Config = {
  path: "/api/hmp-invoices",
};
