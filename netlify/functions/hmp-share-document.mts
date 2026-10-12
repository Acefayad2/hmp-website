import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSameOriginMutation } from "./_conversation-security.mts";
import { prepareDocumentConversation, recordSharedDocument } from "./_document-messages.mts";
import { adminSecondFactorRequired, isAdminSecondFactorVerified } from "./_admin-second-factor.mts";

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

export const createShareDocumentHandler = ({ getUserFn = getUser, databaseFactory = getDatabase, verifySecondFactorFn = isAdminSecondFactorVerified } = {}) => async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
  const user = await getUserFn();
  const email = user?.email?.toLowerCase();
  const allowed = (Netlify.env.get("HMP_ADMIN_EMAILS") || "").split(",").map((value) => value.trim().toLowerCase());
  if (!email || !allowed.includes(email)) return json({ error: "Unauthorized" }, 401);
  if (!verifySecondFactorFn(request, user)) return adminSecondFactorRequired();
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const kind = body.kind;
  const id = body.id;
  if ((kind !== "invoice" && kind !== "contract") || typeof id !== "string" || !uuid.test(id)) {
    return json({ error: "Invalid document" }, 400);
  }
  const client = databaseFactory();
  if (!client) return json({ error: "Documents are unavailable" }, 503);
  const { data: record, error } = await client.from(`hmp_admin_${kind}s`).select("*").eq("id", id).maybeSingle();
  if (error || !record) return json({ error: "Document not found" }, 404);
  if (kind === "invoice" && (record.archived_at || record.deleted_at)) return json({ error: "Restore this invoice before sharing it" }, 409);
  if (record.status === "Void") return json({ error: "A void document cannot be shared" }, 409);
  const recipient = String(record.client_email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return json({ error: "Save a valid client email first" }, 400);
  try {
    const prepared = await prepareDocumentConversation(client, kind, record, recipient, email);
    await recordSharedDocument(client, kind, record, prepared.conversation, recipient, email);
    return json({ ok: true, clientUrl: prepared.clientUrl, conversationId: prepared.conversation.id });
  } catch (shareError) {
    return json({ error: shareError instanceof Error ? shareError.message : "Private link could not be created" }, 409);
  }
};

export default createShareDocumentHandler();
export const config: Config = { path: "/api/hmp-documents/share" };
