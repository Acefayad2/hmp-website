import type { Config } from "@netlify/functions";
import { getUser } from "./_admin-verification.mts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSameOriginMutation, conversationToken, newNonce, tokenHash } from "./_conversation-security.mts";
import { SmsError, quoConfig, sendQuoMessage, toE164 } from "./_quo.mts";

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

let database: SupabaseClient | null = null;
const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return database;
};

const logUnavailable = () =>
  new SmsError("Texting is unavailable until the SMS log is ready. Apply the SMS delivery update, then try again.", 503);

export const loadSmsDeliveries = async (client: { from: (table: string) => any }, messageIds: string[]) => {
  const deliveries = new Map<string, Record<string, unknown>>();
  const ids = messageIds.filter((id) => uuidPattern.test(id));
  if (!ids.length) return deliveries;
  try {
    const { data, error } = await client.from("hmp_sms_messages")
      .select("message_id,status,to_number,created_at")
      .in("message_id", ids);
    if (error || !Array.isArray(data)) return deliveries;
    for (const row of data) {
      if (row?.message_id && row.status === "sent") deliveries.set(row.message_id, row);
    }
  } catch {
    return deliveries;
  }
  return deliveries;
};

const nameMatches = (stored: unknown, requested: string) => {
  const name = String(stored || "").trim().toLowerCase();
  const needle = requested.trim().toLowerCase();
  if (!name || !needle) return false;
  return name === needle || name.split(/\s+/).includes(needle);
};

const findInquiriesByPhone = async (client: { from: (table: string) => any }, destination: string) => {
  const matches: Record<string, unknown>[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await client.from("hmp_admin_inquiries")
      .select("submission_id,client_name,phone,status")
      .not("phone", "is", null)
      .order("submission_id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new SmsError("Contacts could not be checked before sending.", 502);
    const batch = data || [];
    for (const row of batch) if (toE164(row.phone) === destination) matches.push(row);
    if (batch.length < 1000) break;
  }
  return matches;
};

const chooseInquiry = (matches: Record<string, unknown>[], contactName: string) => {
  const active = matches.filter((row) => String(row.status || "").toLowerCase() !== "deleted");
  let chosen = active.length ? active : matches;
  if (contactName) {
    const named = chosen.filter((row) => nameMatches(row.client_name, contactName));
    if (named.length) chosen = named;
  }
  if (chosen.length === 1) return { inquiry: chosen[0], ambiguous: false };
  return { inquiry: null, ambiguous: chosen.length > 1 };
};

const ensureConversation = async (client: { from: (table: string) => any }, inquiryId: string) => {
  const { data: existing, error: readError } = await client.from("hmp_client_conversations")
    .select("id").eq("inquiry_id", inquiryId).maybeSingle();
  if (readError) return "";
  if (existing?.id) return String(existing.id);
  const id = crypto.randomUUID();
  const nonce = newNonce();
  const token = conversationToken(id, nonce);
  const now = new Date().toISOString();
  const { error } = await client.from("hmp_client_conversations").insert({
    id,
    inquiry_id: inquiryId,
    access_token_hash: tokenHash(token),
    token_nonce: nonce,
    token_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    updated_at: now,
  });
  if (!error) return id;
  if (error.code === "23505") {
    const { data: raced } = await client.from("hmp_client_conversations").select("id").eq("inquiry_id", inquiryId).maybeSingle();
    return raced?.id ? String(raced.id) : "";
  }
  return "";
};

const saveConversationCopy = async (
  client: { from: (table: string) => any },
  { requestId, conversationId, inquiryId, content, senderName }: {
    requestId: string;
    conversationId: string;
    inquiryId: string | null;
    content: string;
    senderName: string;
  },
) => {
  let messageId = requestId;
  const { error: insertError } = await client.from("hmp_client_messages").insert({
    id: requestId,
    conversation_id: conversationId,
    sender: "admin",
    sender_name: senderName,
    body: content,
  });
  if (insertError && insertError.code !== "23505") return { messageId: "", warning: "The text was sent, but it could not be saved in the conversation." };
  if (insertError) {
    const { data: existing } = await client.from("hmp_client_messages")
      .select("id").eq("id", requestId).eq("conversation_id", conversationId).maybeSingle();
    if (!existing?.id) return { messageId: "", warning: "The text was sent, but it could not be saved in the conversation." };
    messageId = String(existing.id);
  }
  const now = new Date().toISOString();
  const { error: linkError } = await client.from("hmp_sms_messages").update({
    message_id: messageId,
    conversation_id: conversationId,
    inquiry_id: inquiryId,
    updated_at: now,
  }).eq("request_id", requestId);
  await client.from("hmp_client_conversations").update({
    last_message_at: now,
    last_sender: "admin",
    updated_at: now,
  }).eq("id", conversationId);
  return {
    messageId,
    warning: linkError ? "The text was sent and saved in the conversation, but the delivery record could not be linked." : "",
  };
};

const sentResult = (row: Record<string, any>, extra: Record<string, unknown> = {}) => ({
  ok: true,
  duplicate: false,
  to: row.to_number,
  from: row.from_number,
  providerId: row.provider_id || "",
  conversationId: row.conversation_id || null,
  messageId: row.message_id || null,
  inquiryId: row.inquiry_id || null,
  savedToConversation: Boolean(row.message_id),
  historyWarning: "",
  ...extra,
});

export const deliverStaffText = async ({
  client,
  actor,
  senderName,
  body,
  fetchFn = fetch,
}: {
  client: { from: (table: string) => any };
  actor: string;
  senderName: string;
  body: Record<string, unknown>;
  fetchFn?: typeof fetch;
}) => {
  const content = cleanText(body.content ?? body.message, 1600);
  if (!content) throw new SmsError("Enter a text message.", 400);
  const requestedId = cleanText(body.requestId, 36);
  const requestId = uuidPattern.test(requestedId) ? requestedId : crypto.randomUUID();
  const conversationIdInput = cleanText(body.conversationId, 36);
  const inquiryIdInput = cleanText(body.inquiryId, 36);
  const contactName = cleanText(body.contactName, 120);
  const explicitTo = cleanText(body.to, 40);
  if (conversationIdInput && !uuidPattern.test(conversationIdInput)) throw new SmsError("Invalid conversation.", 400);
  if (inquiryIdInput && !uuidPattern.test(inquiryIdInput)) throw new SmsError("Invalid inquiry.", 400);
  if (!conversationIdInput && !inquiryIdInput && !explicitTo && !contactName) {
    throw new SmsError("Choose a contact or enter a mobile number.", 400);
  }

  let inquiry: Record<string, any> | null = null;
  let conversationId = "";
  let ambiguousMatch = false;
  if (conversationIdInput) {
    const { data, error } = await client.from("hmp_client_conversations")
      .select("id,inquiry_id").eq("id", conversationIdInput).maybeSingle();
    if (error) throw new SmsError("The conversation could not be checked.", 502);
    if (!data) throw new SmsError("Conversation not found.", 404);
    conversationId = data.id;
    const inquiryResult = await client.from("hmp_admin_inquiries")
      .select("submission_id,client_name,phone,status").eq("submission_id", data.inquiry_id).maybeSingle();
    if (inquiryResult.error) throw new SmsError("The contact could not be checked.", 502);
    if (!inquiryResult.data) throw new SmsError("The contact for this conversation could not be found.", 404);
    inquiry = inquiryResult.data;
  } else if (inquiryIdInput) {
    const { data, error } = await client.from("hmp_admin_inquiries")
      .select("submission_id,client_name,phone,status").eq("submission_id", inquiryIdInput).maybeSingle();
    if (error) throw new SmsError("The contact could not be checked.", 502);
    if (!data) throw new SmsError("Inquiry not found.", 404);
    inquiry = data;
  }

  let destination = "";
  if (inquiry) {
    destination = toE164(inquiry.phone);
    if (!destination) throw new SmsError("This contact needs a valid mobile number before a text can be sent.", 400);
    if (explicitTo && toE164(explicitTo) !== destination) {
      throw new SmsError("That number does not match the phone number saved on this contact.", 409);
    }
  } else if (explicitTo) {
    destination = toE164(explicitTo);
    if (!destination) throw new SmsError("Enter a valid mobile number, including the area code.", 400);
    const matches = await findInquiriesByPhone(client, destination);
    const chosen = chooseInquiry(matches, contactName);
    inquiry = chosen.inquiry;
    ambiguousMatch = chosen.ambiguous;
  } else {
    throw new SmsError("Enter a mobile number for this contact.", 400);
  }

  const { data: existing, error: existingError } = await client.from("hmp_sms_messages")
    .select("*").eq("request_id", requestId).maybeSingle();
  if (existingError) throw logUnavailable();
  if (existing?.status === "sent") return sentResult(existing, { duplicate: true });
  if (existing?.status === "pending") {
    const started = Date.parse(existing.updated_at || existing.created_at || "");
    if (Number.isFinite(started) && Date.now() - started < 2 * 60 * 1000) {
      throw new SmsError("This text is already being sent.", 409);
    }
  }

  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await client.from("hmp_sms_messages").select("id", { count: "exact", head: true }).gte("created_at", since);
  if (recent.error) throw logUnavailable();
  if ((recent.count || 0) >= 30) throw new SmsError("Too many texts were sent in the last minute. Wait and try again.", 429);

  const config = quoConfig();
  const now = new Date().toISOString();
  const logRow = {
    id: requestId,
    request_id: requestId,
    conversation_id: conversationId || null,
    inquiry_id: inquiry?.submission_id || null,
    message_id: null,
    contact_name: inquiry?.client_name || contactName || null,
    to_number: destination,
    from_number: config.from,
    body: content,
    provider_id: null,
    status: "pending",
    error: null,
    created_by: actor,
    updated_at: now,
  };
  if (existing) {
    const { id: _id, request_id: _requestId, ...changes } = logRow;
    const { error } = await client.from("hmp_sms_messages").update(changes).eq("request_id", requestId).neq("status", "sent");
    if (error) throw logUnavailable();
  } else {
    const { error } = await client.from("hmp_sms_messages").insert(logRow);
    if (error?.code === "23505") throw new SmsError("This text is already being sent.", 409);
    if (error) throw logUnavailable();
  }

  let delivered;
  try {
    delivered = await sendQuoMessage({ to: destination, content, fetchFn });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quo did not accept the text.";
    await client.from("hmp_sms_messages").update({
      status: "failed",
      error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("request_id", requestId).neq("status", "sent");
    throw error instanceof SmsError ? error : new SmsError(message, 502);
  }

  const { error: sentError } = await client.from("hmp_sms_messages").update({
    status: "sent",
    provider_id: delivered.providerId || null,
    from_number: delivered.from,
    to_number: delivered.to,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq("request_id", requestId);
  if (sentError) {
    return sentResult({
      ...logRow,
      status: "sent",
      provider_id: delivered.providerId,
      from_number: delivered.from,
      to_number: delivered.to,
    }, { historyWarning: "The text was sent. The delivery log could not be updated, so do not send this same text again until you confirm it in Quo." });
  }

  let historyWarning = "";
  let messageId = "";
  if (!conversationId && inquiry?.submission_id) {
    conversationId = await ensureConversation(client, inquiry.submission_id);
    if (!conversationId) historyWarning = "The text was sent, but it could not be saved in a conversation.";
  }
  if (conversationId) {
    const saved = await saveConversationCopy(client, {
      requestId,
      conversationId,
      inquiryId: inquiry?.submission_id || null,
      content,
      senderName,
    });
    messageId = saved.messageId;
    historyWarning = saved.warning;
  } else if (ambiguousMatch) {
    historyWarning = "The text was sent. More than one inquiry uses this number, so it was not added to a conversation.";
  }

  return {
    ok: true,
    duplicate: false,
    to: delivered.to,
    from: delivered.from,
    providerId: delivered.providerId,
    conversationId: messageId ? conversationId : null,
    messageId: messageId || null,
    inquiryId: inquiry?.submission_id || null,
    savedToConversation: Boolean(messageId),
    historyWarning,
  };
};

export const createSmsHandler = ({
  getUserFn = getUser,
  databaseFactory = getDatabase,
  fetchFn = fetch,
}: {
  getUserFn?: typeof getUser;
  databaseFactory?: () => SupabaseClient | null;
  fetchFn?: typeof fetch;
} = {}) => async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const user = await getUserFn(request);
  const email = user?.email?.toLowerCase() || "";
  if (!email || !allowedEmails().includes(email)) return json({ error: "Unauthorized" }, 401);
  if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
  const client = databaseFactory();
  if (!client) return json({ error: "Texting is unavailable" }, 503);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 8000) return json({ error: "Request is too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!body || Array.isArray(body) || typeof body !== "object") return json({ error: "Invalid request" }, 400);
  try {
    return json(await deliverStaffText({
      client,
      actor: email,
      senderName: cleanText(user?.name, 200) || "HMP representative",
      body,
      fetchFn,
    }));
  } catch (error) {
    const status = error instanceof SmsError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Text could not be sent.";
    if (!(error instanceof SmsError)) console.error("Staff text failed");
    return json({ error: message }, status);
  }
};

export default createSmsHandler();

export const config: Config = { path: "/api/hmp-sms" };
