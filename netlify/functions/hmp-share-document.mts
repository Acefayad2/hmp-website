import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSameOriginMutation } from "./_conversation-security.mts";
import { prepareDocumentConversation, recordSharedDocument, stableId } from "./_document-messages.mts";
import { clientConversationUrl } from "./_conversation-security.mts";
import { createReceipt, createStandaloneReceipt } from "../../receipt-template.mjs";
import { normalizeInvoice } from "./hmp-invoices.mts";
import { businessDate, expiryDateAfter, linkExpiration } from "../../document-expiry.mjs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let database: SupabaseClient | null = null;
const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL"), key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return database;
};

export const createShareDocumentHandler = ({ getUserFn = getUser, databaseFactory = getDatabase } = {}) => async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
  const user = await getUserFn();
  const email = user?.email?.toLowerCase();
  const allowed = (Netlify.env.get("HMP_ADMIN_EMAILS") || "").split(",").map((value) => value.trim().toLowerCase());
  if (!email || !allowed.includes(email)) return json({ error: "Unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 20000) return json({error:"Document request is too large"},413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return json({ error: "Invalid request" }, 400); }
  let expiresAt: string;
  try { expiresAt = linkExpiration(body.expirationDate ?? expiryDateAfter(7)); }
  catch (error) { return json({error: error.message},400); }
  const kind = body.kind;
  const id = body.id;
  const client = databaseFactory();
  if (!client) return json({ error: "Documents are unavailable" }, 503);
  if (kind === "receipt") {
    try {
      if (typeof body.conversationId !== "string" || !uuid.test(body.conversationId)) throw new Error("Choose the correct client / event portal.");
      const details = body.details as any;
      let receipt;
      let invoice;
      if (body.invoiceId) {
        if (typeof body.invoiceId !== "string" || !uuid.test(body.invoiceId)) throw new Error("Choose a valid invoice.");
        const {data, error} = await client.from("hmp_admin_invoices").select("*").eq("id",body.invoiceId).maybeSingle();
        if (error || !data || data.deleted_at || data.archived_at) throw new Error("Invoice is unavailable. Reopen the receipt and check its invoice.");
        if (data.updated_at !== body.invoiceUpdatedAt) throw new Error("The invoice has changed. Reopen the receipt before sharing it.");
        invoice = data;
        receipt = createReceipt(normalizeInvoice(data), details, businessDate());
      } else receipt = createStandaloneReceipt(details, businessDate());
      const {data: conversation, error: conversationError} = await client.from("hmp_client_conversations").select("*").eq("id",body.conversationId).maybeSingle();
      if (conversationError || !conversation || conversation.revoked_at || !conversation.token_nonce || !(Date.parse(conversation.token_expires_at)>Date.now())) throw new Error("The client portal link is inactive. Create an active link in Messages first.");
      const {data: inquiry, error: inquiryError} = await client.from("hmp_admin_inquiries").select("email,celebration_date").eq("submission_id",conversation.inquiry_id).maybeSingle();
      if (inquiryError || !inquiry || !receipt.clientEmail || String(inquiry.email).trim().toLowerCase() !== receipt.clientEmail.trim().toLowerCase()
        || (invoice?.inquiry_id && invoice.inquiry_id !== conversation.inquiry_id)
        || (receipt.eventDate && inquiry.celebration_date && receipt.eventDate !== inquiry.celebration_date)) throw new Error("The receipt's client email or event does not match this portal. Select the correct event and check the receipt details.");
      const receiptId = stableId(`receipt/${body.invoiceId || "standalone"}/${JSON.stringify(receipt)}`);
      const document = {kind:"receipt",id:receiptId,number:receipt.receiptNumber,receipt,expiresAt};
      const messageId = stableId(`shared-receipt/${conversation.id}/${receiptId}/${expiresAt}`);
      const {error: insertError} = await client.from("hmp_client_messages").insert({id:messageId,conversation_id:conversation.id,sender:"admin",sender_name:email,body:"Payment receipt shared",document});
      if (insertError && insertError.code !== "23505") throw new Error("Receipt could not be saved to the client portal. Please try again.");
      if (!insertError) await client.from("hmp_client_conversations").update({last_message_at:new Date().toISOString(),last_sender:"admin"}).eq("id",conversation.id);
      return json({ok:true,expiresAt,clientUrl:clientConversationUrl(conversation.id,conversation.token_nonce)+"&section=receipts",conversationId:conversation.id});
    } catch (error) { return json({error:error instanceof Error ? error.message : "Receipt could not be shared"},400); }
  }
  if ((kind !== "invoice" && kind !== "contract") || typeof id !== "string" || !uuid.test(id)) {
    return json({ error: "Invalid document" }, 400);
  }
  const { data: record, error } = await client.from(`hmp_admin_${kind}s`).select("*").eq("id", id).maybeSingle();
  if (error || !record) return json({ error: "Document not found" }, 404);
  if (kind === "invoice" && (record.archived_at || record.deleted_at)) return json({ error: "Restore this invoice before sharing it" }, 409);
  if (record.status === "Void") return json({ error: "A void document cannot be shared" }, 409);
  const recipient = String(record.client_email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return json({ error: "Save a valid client email first" }, 400);
  try {
    const prepared = await prepareDocumentConversation(client, kind, record, recipient, email);
    await recordSharedDocument(client, kind, record, prepared.conversation, recipient, email, expiresAt);
    return json({ ok: true, expiresAt, clientUrl: prepared.clientUrl + `&section=${kind}s`, conversationId: prepared.conversation.id });
  } catch (shareError) {
    return json({ error: shareError instanceof Error ? shareError.message : "Private link could not be created" }, 409);
  }
};

export default createShareDocumentHandler();
export const config: Config = { path: "/api/hmp-documents/share" };
