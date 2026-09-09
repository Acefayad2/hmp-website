import type { SupabaseClient } from "@supabase/supabase-js";

export const ATTACHMENT_BUCKET = "hmp-conversation-attachments";
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/ogg",
  "video/x-msvideo",
  "video/mpeg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

export type ConversationAttachment = {
  id: string;
  name: string;
  path: string;
  type: string;
  size: number;
  url?: string;
};

const cleanText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

export const isAllowedAttachmentType = (type: string) =>
  allowedTypes.has(type);

const safeFileName = (value: unknown) => {
  const original = cleanText(value, 180) || "attachment";
  const normalized = original
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return normalized || "attachment";
};

export const prepareAttachmentUpload = async (
  client: SupabaseClient,
  conversationId: string,
  messageId: string,
  uploader: "client" | "admin",
  input: Record<string, unknown>,
) => {
  const name = cleanText(input.name, 180);
  const type = cleanText(input.type, 160).toLowerCase();
  const size = Number(input.size);
  if (!uuidPattern.test(messageId)) throw new Error("Invalid message upload");
  if (!name || !Number.isFinite(size) || size < 1 || size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Each attachment must be 25 MB or smaller");
  }
  if (!isAllowedAttachmentType(type)) throw new Error("This file type is not supported");

  const id = crypto.randomUUID();
  const path = `${conversationId}/${messageId}/${id}-${safeFileName(name)}`;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await client
    .from("hmp_conversation_attachment_uploads")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("uploader", uploader)
    .gte("created_at", oneHourAgo);
  if ((count || 0) >= 20) throw new Error("Please wait before uploading more attachments");
  const { error: intentError } = await client
    .from("hmp_conversation_attachment_uploads")
    .insert({ id, conversation_id: conversationId, message_id: messageId, path, file_name: name, content_type: type, file_size: size, uploader });
  if (intentError) throw new Error("Attachment upload is unavailable");
  const { data, error } = await client.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    await client.from("hmp_conversation_attachment_uploads").delete().eq("id", id);
    throw new Error("Attachment upload is unavailable");
  }
  return {
    attachment: { id, name, path, type, size } satisfies ConversationAttachment,
    signedUrl: data.signedUrl,
  };
};

export const parseAttachments = (
  value: unknown,
  conversationId: string,
  messageId: string,
): ConversationAttachment[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw new Error("Attach up to 4 files");
  let totalSize = 0;
  const prefix = `${conversationId}/${messageId}/`;
  const attachments = value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const id = cleanText(row.id, 36);
    const name = cleanText(row.name, 180);
    const path = cleanText(row.path, 500);
    const type = cleanText(row.type, 160).toLowerCase();
    const size = Number(row.size);
    if (!uuidPattern.test(id) || !name || !path.startsWith(prefix) || !path.includes(`${id}-`)) {
      throw new Error("Invalid attachment");
    }
    if (!Number.isFinite(size) || size < 1 || size > MAX_ATTACHMENT_BYTES || !isAllowedAttachmentType(type)) {
      throw new Error("Invalid attachment");
    }
    totalSize += size;
    return { id, name, path, type, size };
  });
  if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("Attachments must total 50 MB or less");
  return attachments;
};

export const verifyAttachmentsExist = async (
  client: SupabaseClient,
  attachments: ConversationAttachment[],
  conversationId: string,
  messageId: string,
) => {
  if (!attachments.length) return;
  const { data: intents, error: intentError } = await client
    .from("hmp_conversation_attachment_uploads")
    .select("id,path")
    .eq("conversation_id", conversationId)
    .eq("message_id", messageId)
    .in("id", attachments.map((attachment) => attachment.id));
  if (intentError || !intents || intents.length !== attachments.length) {
    throw new Error("Invalid attachment upload");
  }
  const intentPaths = new Set(intents.map((intent) => intent.path));
  if (attachments.some((attachment) => !intentPaths.has(attachment.path))) {
    throw new Error("Invalid attachment upload");
  }
  const folder = `${conversationId}/${messageId}`;
  const { data, error } = await client.storage.from(ATTACHMENT_BUCKET).list(folder, { limit: 20 });
  if (error) throw new Error("Attachments could not be verified");
  const names = new Set((data || []).map((item) => item.name));
  if (attachments.some((attachment) => !names.has(attachment.path.slice(folder.length + 1)))) {
    throw new Error("Finish uploading every attachment before sending");
  }
};

export const completeAttachmentUploads = async (
  client: SupabaseClient,
  attachments: ConversationAttachment[],
) => {
  if (!attachments.length) return;
  await client
    .from("hmp_conversation_attachment_uploads")
    .update({ attached_at: new Date().toISOString() })
    .in("id", attachments.map((attachment) => attachment.id));
};

export const signAttachments = async (
  client: SupabaseClient,
  attachments: unknown,
): Promise<ConversationAttachment[]> => {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  const safeAttachments = attachments
    .slice(0, MAX_ATTACHMENTS)
    .map((item) => item && typeof item === "object" ? item as ConversationAttachment : null)
    .filter((item): item is ConversationAttachment => Boolean(item?.path && item?.name));
  if (!safeAttachments.length) return [];
  const { data, error } = await client.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrls(safeAttachments.map((attachment) => attachment.path), 60 * 60);
  if (error) return safeAttachments;
  return safeAttachments.map((attachment, index) => ({
    ...attachment,
    url: data?.[index]?.signedUrl || undefined,
  }));
};
