import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSameOriginMutation } from "./_conversation-security.mts";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const proposalPrefix = "HMP_PROPOSAL_V1:";
const allowedEmails = () => (Netlify.env.get("HMP_ADMIN_EMAILS") || "")
  .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);

const draftFields = {
  title: 160, clientName: 200, celebrationType: 200, eventDate: 10,
  eventTime: 100, eventLocation: 500, guestCount: 12, serviceHours: 12,
  associates: 12, machines: 12, serviceDetails: 1400, notes: 1600,
  serviceFee: 20, validUntil: 10, paymentTerms: 600,
} as const;

export const cleanProposalDraft = (value: unknown) => {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const result = Object.fromEntries(Object.entries(draftFields)
    .map(([key, max]) => [key, text(source[key], max)]));
  if (JSON.stringify(result).length > 8000) throw new Error("Proposal draft is too long");
  return result;
};

let database: SupabaseClient | null = null;
const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return database;
};

const normalize = (row: Record<string, any>) => ({
  id: row.id,
  conversationId: row.conversation_id,
  content: row.content,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const createProposalDraftsHandler = ({ getUserFn = getUser, databaseFactory = getDatabase } = {}) => async (request: Request) => {
  const user = await getUserFn();
  if (!user?.email || !allowedEmails().includes(user.email.toLowerCase())) return json({ error: "Unauthorized" }, 401);
  const client = databaseFactory();
  if (!client) return json({ error: "Proposal drafts are unavailable" }, 503);

  if (request.method === "GET") {
    const { data, error } = await client.from("hmp_admin_proposal_drafts")
      .select("id,conversation_id,content,created_at,updated_at")
      .is("sent_at", null).order("updated_at", { ascending: false }).limit(500);
    if (error) return json({ error: "Proposal drafts are unavailable" }, 502);
    return json({ drafts: (data || []).map(normalize) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const id = text(body.id, 36);
  const conversationId = text(body.conversationId, 36);
  if (!uuidPattern.test(id) || !uuidPattern.test(conversationId)) return json({ error: "Invalid proposal draft" }, 400);

  const { data: conversation, error: conversationError } = await client.from("hmp_client_conversations")
    .select("id").eq("id", conversationId).maybeSingle();
  if (conversationError) return json({ error: "Conversation is unavailable" }, 502);
  if (!conversation) return json({ error: "Conversation not found" }, 404);

  if (body.action === "mark-sent") {
    const { data: draft, error: draftError } = await client.from("hmp_admin_proposal_drafts")
      .select("id,sent_at").eq("id", id).eq("conversation_id", conversationId).maybeSingle();
    if (draftError) return json({ error: "Proposal draft is unavailable" }, 502);
    if (!draft) return json({ error: "Proposal draft not found" }, 404);
    if (draft.sent_at) return json({ ok: true, alreadySent: true });
    const { data: sentMessage, error: messageError } = await client.from("hmp_client_messages")
      .select("id,body").eq("id", id).eq("conversation_id", conversationId).eq("sender", "admin").maybeSingle();
    if (messageError) return json({ error: "Sent proposal could not be verified" }, 502);
    if (!sentMessage?.body?.startsWith(proposalPrefix)) return json({ error: "Sent proposal not found" }, 404);
    const { data, error } = await client.from("hmp_admin_proposal_drafts")
      .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id).eq("conversation_id", conversationId).is("sent_at", null)
      .select("id").maybeSingle();
    if (error) return json({ error: "Draft status could not be updated" }, 502);
    return json({ ok: true, alreadySent: !data });
  }
  if (body.action !== "save") return json({ error: "Invalid action" }, 400);
  let content;
  try { content = cleanProposalDraft(body.content); } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Draft is invalid" }, 400);
  }
  const { data: existing, error: readError } = await client.from("hmp_admin_proposal_drafts")
    .select("id,conversation_id,sent_at").eq("id", id).maybeSingle();
  if (readError) return json({ error: "Proposal draft is unavailable" }, 502);
  if (existing && existing.conversation_id !== conversationId) return json({ error: "Proposal draft not found" }, 404);
  if (existing?.sent_at) return json({ error: "This proposal has already been sent" }, 409);
  const query = existing
    ? client.from("hmp_admin_proposal_drafts").update({ content, updated_at: new Date().toISOString() })
      .eq("id", id).eq("conversation_id", conversationId).is("sent_at", null)
    : client.from("hmp_admin_proposal_drafts").insert({ id, conversation_id: conversationId, content });
  const { data, error } = await query.select("id,conversation_id,content,created_at,updated_at").maybeSingle();
  if (error) return json({ error: "Proposal draft could not be saved" }, 502);
  if (!data) return json({ error: "Proposal draft was already sent" }, 409);
  return json({ ok: true, draft: normalize(data) });
};

export default createProposalDraftsHandler();
export const config: Config = { path: "/api/hmp-proposal-drafts" };
