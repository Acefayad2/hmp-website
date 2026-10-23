import type { Config } from "@netlify/functions";
import { getUser } from "./_admin-verification.mts";
import { createClient } from "@supabase/supabase-js";
import { normalizeProposal } from "../../proposal-ui.js";
import { isSameOriginMutation } from "./_conversation-security.mts";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const table = "hmp_admin_proposal_drafts";

export const createProposalDraftHandler = ({ getUserFn = getUser, databaseFactory = createClient } = {}) => async (request: Request) => {
  const user = await getUserFn(request);
  const email = user?.email?.toLowerCase() || "";
  const allowed = (Netlify.env.get("HMP_ADMIN_EMAILS") || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!email || !allowed.includes(email)) return json({ error: "Unauthorized" }, 401);
  const url = Netlify.env.get("SUPABASE_URL"), key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Drafts are unavailable" }, 503);
  const db = databaseFactory(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (request.method === "GET") {
    const { data, error } = await db.from(table).select("id,conversation_id,payload,created_at,updated_at")
      .is("sent_at", null).order("updated_at", { ascending: false }).limit(500);
    if (error) return json({ error: "Drafts could not be loaded" }, 502);
    return json({ drafts: (data || []).map(row => ({
      id: row.id, conversationId: row.conversation_id, payload: row.payload,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
  if (Number(request.headers.get("content-length") || 0) > 10000) return json({ error: "Draft is too large" }, 413);
  let body: Record<string, any>;
  try {
    const input = await request.text();
    if (input.length > 10000) return json({ error: "Draft is too large" }, 413);
    body = JSON.parse(input);
  } catch { return json({ error: "Invalid request" }, 400); }
  if (!body || Array.isArray(body) || typeof body !== "object") return json({ error: "Invalid request" }, 400);
  const id = typeof body.id === "string" ? body.id : "";
  if (id && !uuid.test(id)) return json({ error: "Invalid draft" }, 400);

  if (body.action === "mark-sent") {
    if (!id || !uuid.test(body.messageId || "") || !uuid.test(body.conversationId || "")) return json({ error: "Invalid draft or message" }, 400);
    const {data,error}=await db.rpc("hmp_mark_proposal_revision_sent",{p_id:id,p_message_id:body.messageId,p_conversation_id:body.conversationId});
    if (error || !data) return json({ error: "Proposal was sent, but its draft could not be cleared. Refresh before sending again." }, 502);
    return json({ ok: true });
  }
  if (body.action !== "save") return json({ error: "Invalid action" }, 400);
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  if (!uuid.test(conversationId)) return json({ error: "Choose a client conversation" }, 400);
  const { data: conversation, error: conversationError } = await db.from("hmp_client_conversations")
    .select("id").eq("id", conversationId).maybeSingle();
  if (conversationError) return json({ error: "Client conversation could not be verified" }, 502);
  if (!conversation) return json({ error: "Client conversation not found" }, 404);
  const payload = normalizeProposal(body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {});
  if (JSON.stringify(payload).length > 6000) return json({ error: "Shorten the proposal details" }, 400);
  const now = new Date().toISOString();
  const query = id
    ? db.from(table).update({ conversation_id: conversationId, payload, updated_at: now }).eq("id", id).is("sent_at", null)
    : db.from(table).insert({ conversation_id: conversationId, payload, created_by: email });
  const { data, error } = await query.select("id,conversation_id,payload,created_at,updated_at").maybeSingle();
  if (error) return json({ error: "Draft could not be saved" }, 502);
  if (!data) return json({ error: "Draft is no longer available" }, 409);
  return json({ draft: { id: data.id, conversationId: data.conversation_id, payload: data.payload, createdAt: data.created_at, updatedAt: data.updated_at } });
};

export default createProposalDraftHandler();
export const config: Config = { path: "/api/hmp-proposal-drafts" };
