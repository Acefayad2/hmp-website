import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient } from "@supabase/supabase-js";
import { receiptDraftPayload } from "../../receipt-draft.mjs";
import { isSameOriginMutation } from "./_conversation-security.mts";

const json = (body: unknown, status = 200) => Response.json(body, { status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const table = "hmp_admin_receipt_drafts";
const columns = "id,invoice_id,payload,revision,created_at,updated_at,invoice:hmp_admin_invoices(invoice_number,client_name,event_name)";
const normalize = row => ({ id: row.id, invoiceId: row.invoice_id, payload: row.payload, revision: row.revision,
  createdAt: row.created_at, updatedAt: row.updated_at, invoiceNumber: row.invoice?.invoice_number || "",
  clientName: row.payload?.receiptMode === "standalone" ? row.payload.clientName || "" : row.invoice?.client_name || "",
  eventName: row.payload?.receiptMode === "standalone" ? row.payload.eventName || "" : row.invoice?.event_name || "",
});

export const createReceiptDraftHandler = ({ getUserFn = getUser, databaseFactory = createClient } = {}) => async (request: Request) => {
  const user = await getUserFn();
  const email = user?.email?.toLowerCase() || "";
  const allowed = (Netlify.env.get("HMP_ADMIN_EMAILS") || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!email || !allowed.includes(email)) return json({ error: "Unauthorized" }, 401);
  const url = Netlify.env.get("SUPABASE_URL"), key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Receipt drafts are unavailable" }, 503);
  const db = databaseFactory(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if (request.method === "GET") {
    const { data, error } = await db.from(table).select(columns).order("updated_at", { ascending: false }).limit(500);
    if (error) return json({ error: "Receipt drafts could not be loaded" }, 502);
    return json({ drafts: (data || []).map(normalize) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
  if (Number(request.headers.get("content-length") || 0) > 10000) return json({ error: "Draft is too large" }, 413);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 10000) return json({ error: "Draft is too large" }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: "Invalid request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
  const id = body.id || null, invoiceId = body.invoiceId || null;
  if ((id && (typeof id !== "string" || !uuid.test(id))) || (invoiceId && (typeof invoiceId !== "string" || !uuid.test(invoiceId)))) return json({ error: "Invalid receipt draft or invoice" }, 400);
  if (id && (!Number.isSafeInteger(body.revision) || body.revision < 1)) return json({ error: "Reopen this draft before saving" }, 400);
  let payload;
  try { payload = receiptDraftPayload(body.payload); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid receipt draft" }, 400); }
  if (payload.receiptMode === "standalone" && invoiceId) return json({ error: "A standalone receipt must not be linked to an invoice." }, 400);
  if (invoiceId) {
    const { data, error } = await db.from("hmp_admin_invoices").select("id,status,deleted_at").eq("id", invoiceId).maybeSingle();
    if (error) return json({ error: "Invoice could not be verified" }, 502);
    if (!data || data.deleted_at || data.status === "Void") return json({ error: "This invoice is deleted, voided, or unavailable. Choose another invoice before saving." }, 409);
  }
  const values = { invoice_id: invoiceId, payload, updated_at: new Date().toISOString() };
  const query = id
    ? db.from(table).update({ ...values, revision: body.revision + 1 }).eq("id", id).eq("revision", body.revision)
    : db.from(table).insert({ ...values, created_by: email });
  const { data, error } = await query.select(columns).maybeSingle();
  if (error) return json({ error: "Receipt draft could not be saved. Your entries are still here; please try again." }, 502);
  if (!data) return json({ error: "This receipt draft changed in another session. Copy your entries, then reopen the latest draft before saving." }, 409);
  return json({ draft: normalize(data) });
};

export default createReceiptDraftHandler();
export const config: Config = { path: "/api/hmp-receipt-drafts" };
