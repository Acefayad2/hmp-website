import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  clientConversationUrl,
  conversationToken,
  isSameOriginMutation,
  newNonce,
  tokenHash,
} from "./_conversation-security.mts";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });

const allowedEmails = () =>
  (Netlify.env.get("HMP_ADMIN_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cleanText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";
const escapeHtml = (value: unknown) =>
  cleanText(value, 5000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let database: SupabaseClient | null = null;
const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  database = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return database;
};

const sendReplyNotification = async (
  inquiry: Record<string, unknown>,
  conversation: Record<string, unknown>,
) => {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from =
    Netlify.env.get("HMP_INQUIRY_FROM_EMAIL") ||
    Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
  const recipient = cleanText(inquiry.email, 320).toLowerCase();
  if (!apiKey || !from || !recipient) return false;

  const link = clientConversationUrl(
    String(conversation.id),
    String(conversation.token_nonce),
  );
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [recipient],
      reply_to: "info@hmpeds.com",
      subject: "HMP replied to your celebration conversation",
      html: `<div style="margin:0;background:#f8f1eb;padding:32px 16px;color:#4d3232;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #eadbd6;border-radius:20px;overflow:hidden"><div style="background:#734949;padding:28px;color:#fff"><p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;text-transform:uppercase">HMP Luxury Event Services</p><h1 style="margin:0;font-family:Georgia,serif;font-size:30px;font-weight:500">You have a new reply.</h1></div><div style="padding:30px 28px;font-size:16px;line-height:1.7"><p>Hello ${escapeHtml(inquiry.client_name)},</p><p>An HMP representative replied to your private celebration conversation.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#b67c42;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:bold">Talk with a representative</a></p><p style="color:#8b7272;font-size:13px">This private link is unique to your inquiry. Please do not forward it.</p></div></div></div>`,
    }),
  });
  if (!response.ok) console.error("Conversation reply email failed", response.status);
  return response.ok;
};

const sendAccessLink = async (
  inquiry: Record<string, unknown>,
  link: string,
) => {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from =
    Netlify.env.get("HMP_INQUIRY_FROM_EMAIL") ||
    Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
  const recipient = cleanText(inquiry.email, 320).toLowerCase();
  if (!apiKey || !from || !emailPattern.test(recipient)) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [recipient],
      reply_to: "info@hmpeds.com",
      subject: "Your new private HMP conversation link",
      html: `<div style="margin:0;background:#f8f1eb;padding:32px 16px;color:#4d3232;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #eadbd6;border-radius:20px;overflow:hidden"><div style="background:#734949;padding:28px;color:#fff"><p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;text-transform:uppercase">HMP Luxury Event Services</p><h1 style="margin:0;font-family:Georgia,serif;font-size:30px;font-weight:500">Your new private link is ready.</h1></div><div style="padding:30px 28px;font-size:16px;line-height:1.7"><p>Hello ${escapeHtml(inquiry.client_name)},</p><p>Here is your new link to continue your private conversation with the HMP team. Your previous link is no longer active.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#b67c42;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:bold">Talk with a representative</a></p><p style="color:#8b7272;font-size:13px">This link is unique to your inquiry. Please do not forward it.</p></div></div></div>`,
    }),
  });
  if (!response.ok) console.error("Conversation link email failed", response.status);
  return response.ok;
};

export default async (request: Request, _context: Context) => {
  const user = await getUser();
  const email = user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const client = getDatabase();
  if (!client) return json({ error: "Messages are unavailable" }, 503);

  if (request.method === "GET") {
    const { data: conversations, error } = await client
      .from("hmp_client_conversations")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) return json({ error: "Messages are unavailable" }, 502);
    const conversationRows = conversations || [];
    const inquiryIds = conversationRows.map((row) => row.inquiry_id);
    const conversationIds = conversationRows.map((row) => row.id);
    const [{ data: inquiryRows }, { data: messageRows }] = await Promise.all([
      inquiryIds.length
        ? client.from("hmp_admin_inquiries").select("submission_id,client_name,email,service,celebration_date,status").in("submission_id", inquiryIds)
        : Promise.resolve({ data: [] }),
      conversationIds.length
        ? client.from("hmp_client_messages").select("id,conversation_id,sender,sender_name,body,created_at").in("conversation_id", conversationIds).order("created_at", { ascending: true }).limit(2000)
        : Promise.resolve({ data: [] }),
    ]);
    const inquiryMap = new Map((inquiryRows || []).map((row) => [row.submission_id, row]));
    const threads = conversationRows.map((row) => {
      const inquiry = inquiryMap.get(row.inquiry_id) || {};
      return {
        id: row.id,
        inquiryId: row.inquiry_id,
        clientName: inquiry.client_name || "Client",
        clientEmail: inquiry.email || "",
        service: inquiry.service || "Celebration inquiry",
        celebrationDate: inquiry.celebration_date || "",
        inquiryStatus: inquiry.status || "New",
        active: !row.revoked_at && new Date(row.token_expires_at).getTime() > Date.now(),
        expiresAt: row.token_expires_at,
        lastMessageAt: row.last_message_at,
        lastSender: row.last_sender,
        clientUrl: clientConversationUrl(row.id, row.token_nonce),
        messages: (messageRows || [])
          .filter((message) => message.conversation_id === row.id)
          .map((message) => ({
            id: message.id,
            sender: message.sender,
            senderName: message.sender_name || (message.sender === "admin" ? "HMP representative" : inquiry.client_name || "Client"),
            body: message.body,
            createdAt: message.created_at,
          })),
      };
    });
    return json({ threads, updatedAt: new Date().toISOString() });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const action = cleanText(body.action, 32);

  if (action === "create-link" || action === "send-link") {
    const inquiryId = cleanText(body.inquiryId, 36);
    if (!uuidPattern.test(inquiryId)) return json({ error: "Invalid inquiry" }, 400);
    const { data: inquiry } = await client
      .from("hmp_admin_inquiries")
      .select("submission_id,client_name,email,service")
      .eq("submission_id", inquiryId)
      .maybeSingle();
    if (!inquiry) return json({ error: "Inquiry not found" }, 404);
    const { data: existing } = await client
      .from("hmp_client_conversations")
      .select("id")
      .eq("inquiry_id", inquiryId)
      .maybeSingle();
    const conversationId = existing?.id || crypto.randomUUID();
    const nonce = newNonce();
    const token = conversationToken(conversationId, nonce);
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const row = {
      id: conversationId,
      inquiry_id: inquiryId,
      access_token_hash: tokenHash(token),
      token_nonce: nonce,
      token_expires_at: expiresAt,
      revoked_at: null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from("hmp_client_conversations").upsert(row, { onConflict: "inquiry_id" });
    if (error) return json({ error: "Private link could not be created" }, 502);
    const clientUrl = `https://hmpeds.com/conversation#token=${token}`;
    const emailed = action === "send-link"
      ? await sendAccessLink(inquiry, clientUrl).catch(() => false)
      : false;
    return json({
      ok: true,
      conversationId,
      clientUrl,
      expiresAt,
      ...(action === "send-link" ? { emailed } : {}),
    });
  }

  if (action === "send") {
    const conversationId = cleanText(body.conversationId, 36);
    const message = cleanText(body.message, 4000);
    if (!uuidPattern.test(conversationId) || !message) return json({ error: "Enter a message" }, 400);
    const { data: conversation } = await client
      .from("hmp_client_conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conversation) return json({ error: "Conversation not found" }, 404);
    const { data: inquiry } = await client
      .from("hmp_admin_inquiries")
      .select("client_name,email,service")
      .eq("submission_id", conversation.inquiry_id)
      .maybeSingle();
    const now = new Date().toISOString();
    const { data: inserted, error } = await client
      .from("hmp_client_messages")
      .insert({ conversation_id: conversationId, sender: "admin", sender_name: user.name || "HMP representative", body: message })
      .select("id,sender,sender_name,body,created_at")
      .single();
    if (error) return json({ error: "Message could not be sent" }, 502);
    await client.from("hmp_client_conversations").update({ last_message_at: now, last_sender: "admin", updated_at: now }).eq("id", conversationId);
    const notified = inquiry ? await sendReplyNotification(inquiry, conversation).catch(() => false) : false;
    return json({ ok: true, message: { id: inserted.id, sender: inserted.sender, senderName: inserted.sender_name, body: inserted.body, createdAt: inserted.created_at }, notified });
  }

  return json({ error: "Invalid action" }, 400);
};

export const config: Config = { path: "/api/hmp-messages" };
