import type { Config, Context } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSameOriginMutation, tokenHash, validBearerToken } from "./_conversation-security.mts";
import {
  completeAttachmentUploads,
  parseAttachments,
  prepareAttachmentUpload,
  signAttachments,
  verifyAttachmentsExist,
} from "./_conversation-attachments.mts";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
const cleanText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";
const escapeHtml = (value: unknown) =>
  cleanText(value, 5000).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let database: SupabaseClient | null = null;
const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return database;
};

const sendAdminNotification = async (
  inquiry: Record<string, unknown>,
  messageId: string,
) => {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from = Netlify.env.get("HMP_INQUIRY_FROM_EMAIL") || Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
  const to = Netlify.env.get("HMP_INQUIRY_ADMIN_EMAIL") || "info@hmpeds.com";
  if (!apiKey || !from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `hmp-client-message/${messageId}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: cleanText(inquiry.email, 320),
      subject: `New client message — ${cleanText(inquiry.client_name, 200)}`,
      html: `<style>@import url("https://fonts.googleapis.com/css2?family=Droid+Serif:wght@400;700&display=swap");</style><div style="font-family:'Droid Serif',Georgia,serif;color:#4d3232"><h2>New private portal message</h2><p>${escapeHtml(inquiry.client_name)} sent a new message about <strong>${escapeHtml(inquiry.service)}</strong>.</p><p><a href="https://hmpeds.com/admin?view=messages">Open Messages in the HMP portal</a></p></div>`,
    }),
  });
  return response.ok;
};

export default async (request: Request, _context: Context) => {
  const token = validBearerToken(request);
  if (!token) return json({ error: "This private conversation link is invalid or expired." }, 401);
  const client = getDatabase();
  if (!client) return json({ error: "Conversation is temporarily unavailable." }, 503);
  const { data: conversation } = await client
    .from("hmp_client_conversations")
    .select("id,inquiry_id,token_expires_at,revoked_at")
    .eq("access_token_hash", tokenHash(token))
    .maybeSingle();
  if (!conversation || conversation.revoked_at || new Date(conversation.token_expires_at).getTime() <= Date.now()) {
    return json({ error: "This private conversation link is invalid or expired." }, 401);
  }
  const { data: inquiry } = await client
    .from("hmp_admin_inquiries")
    .select("client_name,service,celebration_date,status,email")
    .eq("submission_id", conversation.inquiry_id)
    .maybeSingle();
  if (!inquiry) return json({ error: "Conversation is unavailable." }, 404);

  if (request.method === "GET") {
    const { data: messages, error } = await client
      .from("hmp_client_messages")
      .select("id,sender,sender_name,body,attachments,created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) return json({ error: "Conversation is temporarily unavailable." }, 502);
    const signedMessages = await Promise.all((messages || []).map(async (message) => ({
      ...message,
      signedAttachments: await signAttachments(client, message.attachments),
    })));
    return json({
      conversation: {
        clientName: inquiry.client_name || "Client",
        service: inquiry.service || "Celebration inquiry",
        celebrationDate: inquiry.celebration_date || "",
        status: inquiry.status || "New",
        expiresAt: conversation.token_expires_at,
      },
      messages: signedMessages.map((message) => ({
        id: message.id,
        sender: message.sender,
        senderName: message.sender_name || (message.sender === "admin" ? "HMP representative" : inquiry.client_name || "Client"),
        body: message.body,
        attachments: message.signedAttachments,
        createdAt: message.created_at,
      })),
    });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 6000) return json({ error: "Message is too long." }, 413);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const action = cleanText(body.action, 32);
  if (action === "prepare-upload") {
    try {
      const upload = await prepareAttachmentUpload(
        client,
        conversation.id,
        cleanText(body.messageId, 36),
        "client",
        body,
      );
      return json({ ok: true, ...upload });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Attachment upload is unavailable." }, 400);
    }
  }
  const message = cleanText(body.message, 4000);
  const suppliedRequestId = cleanText(body.requestId, 36);
  const requestId = uuidPattern.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  let attachments;
  try {
    attachments = parseAttachments(body.attachments, conversation.id, requestId);
    await verifyAttachmentsExist(client, attachments, conversation.id, requestId);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Attachments could not be sent." }, 400);
  }
  if (!message && !attachments.length) return json({ error: "Enter a message or add an attachment." }, 400);

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await client
    .from("hmp_client_messages")
    .select("id", { head: true, count: "exact" })
    .eq("conversation_id", conversation.id)
    .eq("sender", "client")
    .gte("created_at", hourAgo);
  if ((count || 0) >= 30) return json({ error: "Please wait before sending another message." }, 429);
  const { data: latest } = await client
    .from("hmp_client_messages")
    .select("created_at")
    .eq("conversation_id", conversation.id)
    .eq("sender", "client")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest && Date.now() - new Date(latest.created_at).getTime() < 2000) {
    return json({ error: "Please wait a moment before sending again." }, 429);
  }
  const now = new Date().toISOString();
  const { data: inserted, error } = await client
    .from("hmp_client_messages")
    .insert({ id: requestId, conversation_id: conversation.id, sender: "client", sender_name: inquiry.client_name || "Client", body: message, attachments })
    .select("id,sender,sender_name,body,attachments,created_at")
    .single();
  if (error?.code === "23505") {
    const { data: existing } = await client
      .from("hmp_client_messages")
      .select("id,sender,sender_name,body,attachments,created_at")
      .eq("id", requestId)
      .eq("conversation_id", conversation.id)
      .eq("sender", "client")
      .maybeSingle();
    if (existing) return json({ ok: true, duplicate: true, message: { id: existing.id, sender: existing.sender, senderName: existing.sender_name, body: existing.body, attachments: existing.attachments, createdAt: existing.created_at } });
  }
  if (error || !inserted) return json({ error: "Message could not be sent." }, 502);
  await completeAttachmentUploads(client, attachments);
  await client.from("hmp_client_conversations").update({ last_message_at: now, last_sender: "client", updated_at: now }).eq("id", conversation.id);
  await sendAdminNotification(inquiry, inserted.id).catch(() => false);
  return json({ ok: true, message: { id: inserted.id, sender: inserted.sender, senderName: inserted.sender_name, body: inserted.body, attachments: inserted.attachments, createdAt: inserted.created_at } });
};

export const config: Config = { path: "/api/hmp-conversation" };
