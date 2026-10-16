import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readMessageHistory } from "./_message-history.mts";
import { privateLink } from "./_agreement-forms.mts";
import { stableId } from "./_document-messages.mts";
import { normalizeServiceHours } from "../../proposal-ui.js";
import {
  clientConversationUrl,
  conversationToken,
  isSameOriginMutation,
  newNonce,
  tokenHash,
} from "./_conversation-security.mts";
import {
  ATTACHMENT_BUCKET,
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
const proposalPrefix = "HMP_PROPOSAL_V1:";
const seatingLinkPattern = /^https:\/\/seating\.hmpeds\.com\/client\/([a-z0-9-]+)\/([a-f0-9]{48})$/i;

const linkedSeatingEvent = async (client: SupabaseClient, url: string) => {
  const match = seatingLinkPattern.exec(url);
  if (!match) return null;
  const { data: index, error: indexError } = await client.from("hmp_seating_records")
    .select("value").eq("key", `public/${match[1]}`).maybeSingle();
  if (indexError) throw new Error("Guest Seating event could not be checked");
  const eventId = String(index?.value?.eventId || "");
  if (!uuidPattern.test(eventId)) return null;
  const { data: record, error: eventError } = await client.from("hmp_seating_records")
    .select("value").eq("key", `events/${eventId}`).maybeSingle();
  if (eventError) throw new Error("Guest Seating event could not be checked");
  const event = record?.value;
  const provided = Buffer.from(match[2], "hex");
  const expected = Buffer.from(String(event?.clientUploadToken || ""), "hex");
  if (!event || event.archived || event.deletedAt || event.dataPurgedAt
    || String(event.publicCode || "").toLowerCase() !== match[1].toLowerCase()
    || !expected.length || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return { id: eventId, event };
};

export const normalizeAdminMessage = (value: unknown) => {
  const message = cleanText(value, 4000);
  if (!message.startsWith(proposalPrefix)) return message;
  let proposal: Record<string, unknown>;
  try {
    proposal = JSON.parse(message.slice(proposalPrefix.length));
  } catch {
    throw new Error("Proposal details are invalid");
  }
  const number = (candidate: unknown, max: number) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : 0;
  };
  const normalized = {
    title: cleanText(proposal.title, 160) || "Service Proposal",
    clientName: cleanText(proposal.clientName, 200),
    celebrationType: cleanText(proposal.celebrationType, 200),
    eventDate: cleanText(proposal.eventDate, 10),
    eventTime: cleanText(proposal.eventTime, 100),
    eventLocation: cleanText(proposal.eventLocation, 500),
    guestCount: number(proposal.guestCount, 100_000),
    serviceHours: normalizeServiceHours(proposal.serviceHours),
    associates: number(proposal.associates, 100),
    machines: number(proposal.machines, 100),
    serviceDetails: cleanText(proposal.serviceDetails, 1400),
    notes: cleanText(proposal.notes, 1600),
    additionalInformation: cleanText(proposal.additionalInformation, 600),
    serviceFee: number(proposal.serviceFee, 1_000_000),
    validUntil: cleanText(proposal.validUntil, 10),
    paymentTerms: cleanText(proposal.paymentTerms, 600),
  };
  if (!normalized.clientName || !normalized.serviceFee) {
    throw new Error("Proposal client and service fee are required");
  }
  const serialized = `${proposalPrefix}${JSON.stringify(normalized)}`;
  if (serialized.length > 4000) throw new Error("Proposal details are too long");
  return serialized;
};

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

export const sendReplyNotification = async (
  inquiry: Record<string, unknown>,
  conversation: Record<string, unknown>,
  messageId: string,
  isProposal = false,
  fetchFn = fetch,
) => {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from =
    Netlify.env.get("HMP_INQUIRY_FROM_EMAIL") ||
    Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
  const recipient = cleanText(inquiry.email, 320).toLowerCase();
  if (!apiKey || !from) throw new Error("Email notifications are not configured. Contact HMP support to check the email sender.");
  if (!emailPattern.test(recipient)) throw new Error("The client needs a valid email address before a notification can be sent.");
  if (conversation.revoked_at || !conversation.token_nonce || !(Date.parse(String(conversation.token_expires_at)) > Date.now())) {
    throw new Error("The client link is inactive. Use Send new link, then retry the email notification.");
  }

  const link = clientConversationUrl(
    String(conversation.id),
    String(conversation.token_nonce),
  );
  const response = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `hmp-admin-message/${messageId}`,
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      reply_to: "info@hmpeds.com",
      subject: isProposal ? "Your HMP service proposal is ready" : "HMP replied to your event conversation",
      html: `<style>@import url("https://fonts.googleapis.com/css2?family=Droid+Serif:wght@400;700&display=swap");</style><div style="margin:0;background:#f8f1eb;padding:32px 16px;color:#4d3232;font-family:'Droid Serif',Georgia,serif"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #eadbd6;border-radius:20px;overflow:hidden"><div style="background:#734949;padding:28px;color:#fff"><p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;text-transform:uppercase">HMP Luxury Event Services</p><h1 style="margin:0;font-family:Georgia,serif;font-size:30px;font-weight:500">${isProposal ? "Your service proposal is ready." : "You have a new reply."}</h1></div><div style="padding:30px 28px;font-size:16px;line-height:1.7"><p>Hello ${escapeHtml(inquiry.client_name)},</p><p>${isProposal ? "HMP prepared a personalized service proposal for your event. Open your private portal to review the details and pricing." : "An HMP Event Concierge team member replied to your private event conversation."}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#b67c42;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:bold">${isProposal ? "View My Proposal" : "Open Client Portal"}</a></p><p style="color:#8b7272;font-size:13px">This private link is unique to your inquiry. Please do not forward it.</p></div></div></div>`,
    }),
  });
  if (!response.ok) console.error("Conversation reply email failed", response.status);
  return response.ok;
};

export const notifyStoredMessage = async (client: any, inquiry: any, conversation: any, message: any, fetchFn = fetch) => {
  if (message.email_notified_at) return {notified:true, notificationError:""};
  let notified=false, notificationError="";
  try {
    if (!inquiry) throw new Error("Client details are unavailable. Refresh the conversation before retrying.");
    notified=await sendReplyNotification(inquiry,conversation,message.id,String(message.body || "").startsWith(proposalPrefix),fetchFn);
    if(!notified) notificationError="The email provider did not accept the notification. Retry the email notification.";
  } catch(error) {
    notificationError=error instanceof Error && /^(Email notifications|The client|Client details)/.test(error.message)
      ? error.message : "Email delivery could not be confirmed. Retry the email notification.";
  }
  // Never let an overlapping failed retry overwrite an already successful send.
  let query=client.from("hmp_client_messages").update(notified
    ? {email_notified_at:new Date().toISOString(),email_notification_error:null}
    : {email_notification_error:notificationError})
    .eq("id",message.id).eq("conversation_id",conversation.id).eq("sender","admin");
  if(!notified) query=query.is("email_notified_at",null);
  try {
    const {error}=await query;
    if(error) return {notified, notificationError, notificationWarning:"Notification status could not be saved. Refresh and verify email status before retrying."};
  } catch {
    return {notified, notificationError, notificationWarning:"Notification status could not be saved. Refresh and verify email status before retrying."};
  }
  return {notified,notificationError};
};

const sendAccessLink = async (
  inquiry: Record<string, unknown>,
  link: string,
  fetchFn: typeof fetch = fetch,
) => {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from =
    Netlify.env.get("HMP_INQUIRY_FROM_EMAIL") ||
    Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
  const recipient = cleanText(inquiry.email, 320).toLowerCase();
  if (!apiKey || !from || !emailPattern.test(recipient)) return false;
  const response = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [recipient],
      reply_to: "info@hmpeds.com",
      subject: "Your new private HMP conversation link",
      html: `<style>@import url("https://fonts.googleapis.com/css2?family=Droid+Serif:wght@400;700&display=swap");</style><div style="margin:0;background:#f8f1eb;padding:32px 16px;color:#4d3232;font-family:'Droid Serif',Georgia,serif"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #eadbd6;border-radius:20px;overflow:hidden"><div style="background:#734949;padding:28px;color:#fff"><p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;text-transform:uppercase">HMP Luxury Event Services</p><h1 style="margin:0;font-family:Georgia,serif;font-size:30px;font-weight:500">Your new private link is ready.</h1></div><div style="padding:30px 28px;font-size:16px;line-height:1.7"><p>Hello ${escapeHtml(inquiry.client_name)},</p><p>Here is your new link to continue your private conversation with the HMP team. Your previous link and PIN are no longer active. Open this new link to choose your own 6-digit PIN. If you ever need to reset it, contact the HMP team.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#b67c42;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:bold">Open Client Portal</a></p><p style="color:#8b7272;font-size:13px">This link is unique to your inquiry. Please do not forward it.</p></div></div></div>`,
    }),
  });
  if (!response.ok) console.error("Conversation link email failed", response.status);
  return response.ok;
};

export const createMessagesHandler = ({getUserFn = getUser, databaseFactory = getDatabase, fetchFn = fetch} = {}) => async (request: Request) => {
  const user = await getUserFn();
  const email = user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const client = databaseFactory();
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
    const [{ data: inquiryRows, error: inquiryError }, { data: messageRows, error: messageError }] = await Promise.all([
      inquiryIds.length
        ? client.from("hmp_admin_inquiries").select("submission_id,client_name,email,service,celebration_date,status").in("submission_id", inquiryIds)
        : Promise.resolve({ data: [], error: null }),
      readMessageHistory(client, conversationIds, "id,conversation_id,sender,sender_name,body,attachments,document,created_at,edited_at,email_notified_at,email_notification_error"),
    ]);
    // A database/schema failure is not an empty conversation. Keep the UI's
    // existing data and surface a retryable error instead of hiding messages.
    if (inquiryError || messageError) return json({ error: "Messages are temporarily unavailable. Please try again." }, 502);
    const signedMessageRows = await Promise.all((messageRows || []).map(async (message) => ({
      ...message,
      signedAttachments: await signAttachments(client, message.attachments),
    })));
    const inquiryMap = new Map((inquiryRows || []).map((row) => [row.submission_id, row]));
    const threads = conversationRows.map((row) => {
      const inquiry = inquiryMap.get(row.inquiry_id) || {};
      return {
        id: row.id,
        inquiryId: row.inquiry_id,
        clientName: inquiry.client_name || "Client",
        clientEmail: inquiry.email || "",
        service: inquiry.service || "Event inquiry",
        celebrationDate: inquiry.celebration_date || "",
        inquiryStatus: inquiry.status || "New",
        active: !row.revoked_at && new Date(row.token_expires_at).getTime() > Date.now(),
        expiresAt: row.token_expires_at,
        lastMessageAt: row.last_message_at,
        lastSender: row.last_sender,
        clientUrl: clientConversationUrl(row.id, row.token_nonce),
        messages: signedMessageRows
          .filter((message) => message.conversation_id === row.id)
          .map((message) => ({
            id: message.id,
            sender: message.sender,
            senderName: message.sender_name || (message.sender === "admin" ? "HMP representative" : inquiry.client_name || "Client"),
            body: message.body,
            document: message.document || null,
            attachments: message.signedAttachments,
            createdAt: message.created_at,
            editedAt: message.edited_at || null,
            emailNotifiedAt: message.email_notified_at || null,
            emailNotificationError: message.email_notification_error || "",
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

  if (action === "seating-activity") {
    const conversationId = cleanText(body.conversationId, 36);
    if (!uuidPattern.test(conversationId)) return json({ error: "Invalid client hub" }, 400);
    const id = stableId(`shared-seating/${conversationId}`);
    const { data: shared, error: readError } = await client.from("hmp_client_messages")
      .select("document,deleted_at").eq("id", id).eq("conversation_id", conversationId).maybeSingle();
    if (readError) return json({ error: "Guest Seating link could not be checked" }, 502);
    if (shared?.deleted_at || shared?.document?.kind !== "seating") return json({ activity: [] });
    try {
      const linked = await linkedSeatingEvent(client, String(shared.document.url || ""));
      if (!linked) return json({ error: "The Guest Seating link is no longer active. Replace it in this client hub." }, 409);
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client.from("hmp_seating_records").select("key,value")
          .like("key", `client-activity/${linked.id}/%`).order("key", { ascending: false }).range(from, from + 999);
        if (error) throw new Error("Guest Seating activity could not be read");
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const allowedKinds = new Set(["sign_in", "pin_setup", "guest_list_uploaded", "guest_list_removed", "guest_added", "guest_updated", "guest_deleted"]);
      const activity = rows.map((row) => row.value)
        .filter((item: any) => allowedKinds.has(item?.action) && item?.eventId === linked.id && !Number.isNaN(Date.parse(item?.createdAt || "")))
        .map((item: any) => ({
          id: cleanText(item.id, 100), kind: item.action, detail: cleanText(item.summary, 300), at: item.createdAt,
        }));
      return json({ activity });
    } catch {
      return json({ error: "Guest Seating activity is unavailable. Please try again later." }, 502);
    }
  }

  if (action === "share-seating") {
    const conversationId = cleanText(body.conversationId, 36);
    const url = cleanText(body.url, 300);
    const match = seatingLinkPattern.exec(url);
    if (!uuidPattern.test(conversationId) || !match) return json({ error: "Enter a valid private Guest Seating client link" }, 400);
    const { data: conversation, error: conversationError } = await client.from("hmp_client_conversations")
      .select("id,inquiry_id,revoked_at,token_expires_at").eq("id", conversationId).maybeSingle();
    if (conversationError) return json({ error: "Client hub could not be checked" }, 502);
    if (!conversation || conversation.revoked_at || !(Date.parse(conversation.token_expires_at) > Date.now()))
      return json({ error: "Create an active client link before adding Guest Seating" }, 409);
    const { data: inquiry, error: inquiryError } = await client.from("hmp_admin_inquiries")
      .select("celebration_date").eq("submission_id", conversation.inquiry_id).maybeSingle();
    if (inquiryError || !inquiry) return json({ error: "The inquiry could not be checked" }, 502);
    let seatingEvent: { name?: string; date?: string; archived?: boolean; deletedAt?: string; dataPurgedAt?: string };
    try {
      const linked = await linkedSeatingEvent(client, url);
      if (!linked || linked.event.archived || linked.event.deletedAt || linked.event.dataPurgedAt)
        return json({ error: "Guest Seating could not verify that active private link" }, 400);
      seatingEvent = linked.event;
    } catch {
      return json({ error: "Guest Seating could not verify that private link. Try again later." }, 502);
    }
    const inquiryDate = String(inquiry.celebration_date || "").slice(0, 10);
    const seatingDate = String(seatingEvent.date || "").slice(0, 10);
    if (inquiryDate && seatingDate && inquiryDate !== seatingDate)
      return json({ error: "The Guest Seating event date does not match this inquiry. Check the selected client and event." }, 409);
    const id = stableId(`shared-seating/${conversationId}`);
    const document = { kind: "seating", title: cleanText(seatingEvent.name, 160) || "Guest Seating Experience", url };
    const { error: insertError } = await client.from("hmp_client_messages").insert({
      id, conversation_id: conversationId, sender: "admin", sender_name: user.name || "HMP representative", body: "", document,
    });
    if (insertError && insertError.code !== "23505") return json({ error: "Guest Seating could not be added to this hub" }, 502);
    if (insertError) {
      const { data: existing, error: readError } = await client.from("hmp_client_messages")
        .select("document,deleted_at").eq("id", id).eq("conversation_id", conversationId).maybeSingle();
      if (readError || !existing) return json({ error: "Guest Seating share could not be checked" }, 502);
      if (!existing.deleted_at) {
        if (existing.document?.url !== url)
          return json({ error: "Remove the old Guest Seating link from this hub before adding a different one" }, 409);
        return json({ ok: true, alreadyShared: true, eventName: document.title });
      }
      const { error: restoreError } = await client.from("hmp_client_messages")
        .update({ deleted_at: null, document }).eq("id", id).eq("conversation_id", conversationId);
      if (restoreError) return json({ error: "Guest Seating could not be restored to this hub" }, 502);
    }
    const now = new Date().toISOString();
    await client.from("hmp_client_conversations")
      .update({ last_message_at: now, last_sender: "admin", updated_at: now }).eq("id", conversationId);
    return json({ ok: true, alreadyShared: false, eventName: document.title });
  }

  if (action === "share-form") {
    const conversationId = cleanText(body.conversationId, 36);
    const formId = cleanText(body.formId, 36);
    if (!uuidPattern.test(conversationId) || !uuidPattern.test(formId)) return json({error:"Invalid form or conversation"}, 400);
    const {data: conversation, error: conversationError} = await client.from("hmp_client_conversations")
      .select("id,inquiry_id,revoked_at,token_expires_at").eq("id", conversationId).maybeSingle();
    if (conversationError) return json({error:"Client hub could not be checked"}, 502);
    if (!conversation || conversation.revoked_at || !(Date.parse(conversation.token_expires_at) > Date.now())) return json({error:"Create an active client link before adding a form"}, 409);
    const [{data: inquiry, error: inquiryError}, {data: form, error: formError}] = await Promise.all([
      client.from("hmp_admin_inquiries").select("email").eq("submission_id", conversation.inquiry_id).maybeSingle(),
      client.from("hmp_client_agreements").select("id,client_email,status,expires_at,token_nonce,snapshot").eq("id", formId).maybeSingle(),
    ]);
    if (inquiryError || formError) return json({error:"Client form could not be checked"}, 502);
    if (!inquiry || !form || !emailPattern.test(String(inquiry.email || "").trim()) || String(inquiry.email || "").trim().toLowerCase() !== String(form.client_email || "").trim().toLowerCase()) return json({error:"This form does not belong to the selected client"}, 403);
    if (!["Sent", "Completed"].includes(form.status) || !(Date.parse(form.expires_at) > Date.now())) return json({error:"Only active sent forms can be added"}, 409);
    const id = stableId(`shared-form/${conversationId}/${formId}`);
    const now = new Date().toISOString();
    const {error: insertError} = await client.from("hmp_client_messages").insert({
      id, conversation_id:conversationId, sender:"admin", sender_name:user.name || "HMP representative",
      body:"", document:{kind:"form",id:form.id,title:cleanText(form.snapshot?.title,160) || "Client form",status:form.status,url:privateLink(form)},
    });
    if (insertError && insertError.code !== "23505") return json({error:"Form could not be added to the client hub"}, 502);
    let restored = false;
    if (insertError) {
      const {data:existing, error:readError} = await client.from("hmp_client_messages").select("deleted_at").eq("id",id).eq("conversation_id",conversationId).maybeSingle();
      if (readError || !existing) return json({error:"Form share could not be checked"}, 502);
      if (existing.deleted_at) {
        const {error:restoreError} = await client.from("hmp_client_messages").update({deleted_at:null,document:{kind:"form",id:form.id,title:cleanText(form.snapshot?.title,160) || "Client form",status:form.status,url:privateLink(form)}}).eq("id",id).eq("conversation_id",conversationId);
        if (restoreError) return json({error:"Form could not be restored to the client hub"}, 502);
        restored = true;
      }
    }
    if (!insertError || restored) await client.from("hmp_client_conversations").update({last_message_at:now,last_sender:"admin",updated_at:now}).eq("id", conversationId);
    return json({ok:true,alreadyShared:Boolean(insertError && !restored)});
  }

  if (action === "edit-message" || action === "delete-message") {
    const conversationId = cleanText(body.conversationId, 36);
    const messageId = cleanText(body.messageId, 36);
    if (!uuidPattern.test(conversationId) || !uuidPattern.test(messageId)) return json({ error: "Invalid message" }, 400);
    const { data: existing, error: readError } = await client.from("hmp_client_messages")
      .select("id,body,document").eq("id", messageId).eq("conversation_id", conversationId)
      .eq("sender", "admin").is("deleted_at", null).maybeSingle();
    if (readError) return json({ error: "Message could not be loaded" }, 502);
    if (!existing) return json({ error: "Admin message not found" }, 404);
    let changes: Record<string, string>;
    if (action === "edit-message") {
      if (existing.document || String(existing.body || "").startsWith(proposalPrefix)) {
        return json({ error: "Proposal and document messages cannot be edited here" }, 400);
      }
      const message = cleanText(body.message, 4000);
      if (!message) return json({ error: "Enter a message" }, 400);
      changes = { body: message, edited_at: new Date().toISOString() };
    } else {
      changes = { deleted_at: new Date().toISOString() };
    }
    const { data: updated, error: updateError } = await client.from("hmp_client_messages")
      .update(changes).eq("id", messageId).eq("conversation_id", conversationId)
      .eq("sender", "admin").is("deleted_at", null).select("id").maybeSingle();
    if (updateError) return json({ error: "Message could not be saved" }, 502);
    if (!updated) return json({ error: "Message changed. Refresh and try again" }, 409);
    return json({ ok: true });
  }

  if (action === "retry-notification") {
    const conversationId=cleanText(body.conversationId,36), messageId=cleanText(body.messageId,36);
    if(!uuidPattern.test(conversationId) || !uuidPattern.test(messageId)) return json({error:"Invalid message"},400);
    const {data:conversation}=await client.from("hmp_client_conversations").select("*").eq("id",conversationId).maybeSingle();
    if(!conversation) return json({error:"Conversation not found"},404);
    const {data:message}=await client.from("hmp_client_messages").select("*").eq("id",messageId).eq("conversation_id",conversationId).eq("sender","admin").is("deleted_at",null).maybeSingle();
    if(!message) return json({error:"Admin message not found"},404);
    const {data:inquiry}=await client.from("hmp_admin_inquiries").select("client_name,email,service").eq("submission_id",conversation.inquiry_id).maybeSingle();
    return json({ok:true,...await notifyStoredMessage(client,inquiry,conversation,message,fetchFn)});
  }

  if (action === "prepare-upload") {
    const conversationId = cleanText(body.conversationId, 36);
    if (!uuidPattern.test(conversationId)) return json({ error: "Invalid conversation" }, 400);
    const { data: conversation } = await client
      .from("hmp_client_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conversation) return json({ error: "Conversation not found" }, 404);
    try {
      const upload = await prepareAttachmentUpload(
        client,
        conversationId,
        cleanText(body.messageId, 36),
        "admin",
        body,
      );
      return json({ ok: true, ...upload });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Attachment upload is unavailable" }, 400);
    }
  }

  if (action === "create-link" || action === "send-link" || action === "reset-pin") {
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
    const emailed = action === "send-link" || action === "reset-pin"
      ? await sendAccessLink(inquiry, clientUrl, fetchFn).catch(() => false)
      : false;
    return json({
      ok: true,
      conversationId,
      clientUrl,
      expiresAt,
      ...(action === "send-link" || action === "reset-pin" ? { emailed } : {}),
    });
  }

  if (action === "delete") {
    const conversationId = cleanText(body.conversationId, 36);
    if (!uuidPattern.test(conversationId)) return json({ error: "Invalid conversation" }, 400);
    const { data: conversation } = await client
      .from("hmp_client_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conversation) return json({ error: "Conversation not found" }, 404);
    const { data: uploadRows, error: uploadReadError } = await client
      .from("hmp_conversation_attachment_uploads")
      .select("path")
      .eq("conversation_id", conversationId);
    if (uploadReadError) return json({ error: "Conversation files could not be prepared for deletion" }, 502);
    const { error: deleteError } = await client
      .from("hmp_client_conversations")
      .delete()
      .eq("id", conversationId);
    if (deleteError) {
      console.error("Conversation delete failed", deleteError.code);
      return json({ error: "Conversation could not be deleted" }, 502);
    }
    const paths = (uploadRows || []).map((row) => row.path).filter(Boolean);
    let cleanupPending = false;
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await client.storage.from(ATTACHMENT_BUCKET).remove(paths.slice(index, index + 100));
      if (error) cleanupPending = true;
    }
    return json({ ok: true, cleanupPending });
  }

  if (action === "send") {
    const conversationId = cleanText(body.conversationId, 36);
    let message = "";
    try {
      message = normalizeAdminMessage(body.message);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Message is invalid" }, 400);
    }
    const suppliedRequestId = cleanText(body.requestId, 36);
    const requestId = uuidPattern.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID();
    if (!uuidPattern.test(conversationId)) return json({ error: "Invalid conversation" }, 400);
    const { data: conversation } = await client
      .from("hmp_client_conversations")
      .select("*")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conversation) return json({ error: "Conversation not found" }, 404);
    let attachments;
    try {
      attachments = parseAttachments(body.attachments, conversationId, requestId);
      await verifyAttachmentsExist(client, attachments, conversationId, requestId);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Attachments could not be sent" }, 400);
    }
    if (!message && !attachments.length) return json({ error: "Enter a message or add an attachment" }, 400);
    const { data: inquiry } = await client
      .from("hmp_admin_inquiries")
      .select("client_name,email,service")
      .eq("submission_id", conversation.inquiry_id)
      .maybeSingle();
    const now = new Date().toISOString();
    const { data: inserted, error } = await client
      .from("hmp_client_messages")
      .insert({ id: requestId, conversation_id: conversationId, sender: "admin", sender_name: user.name || "HMP representative", body: message, attachments, email_notification_error: "Email notification not yet confirmed. Retry if this status persists." })
      .select("id,sender,sender_name,body,attachments,created_at")
      .single();
    if (error?.code === "23505") {
      const { data: existing } = await client
        .from("hmp_client_messages")
        .select("id,sender,sender_name,body,attachments,created_at,email_notified_at,email_notification_error")
        .eq("id", requestId)
        .eq("conversation_id", conversationId)
        .eq("sender", "admin")
        .maybeSingle();
      if (existing) return json({ ok: true, duplicate: true, message: { id: existing.id, sender: existing.sender, senderName: existing.sender_name, body: existing.body, attachments: existing.attachments, createdAt: existing.created_at }, ...await notifyStoredMessage(client,inquiry,conversation,existing,fetchFn) });
    }
    if (error || !inserted) return json({ error: "Message could not be sent" }, 502);
    await completeAttachmentUploads(client, attachments);
    await client.from("hmp_client_conversations").update({ last_message_at: now, last_sender: "admin", updated_at: now }).eq("id", conversationId);
    const notification = await notifyStoredMessage(client,inquiry,conversation,inserted,fetchFn);
    return json({ ok: true, message: { id: inserted.id, sender: inserted.sender, senderName: inserted.sender_name, body: inserted.body, attachments: inserted.attachments, createdAt: inserted.created_at }, ...notification });
  }

  return json({ error: "Invalid action" }, 400);
};

export default createMessagesHandler();

export const config: Config = { path: "/api/hmp-messages" };
