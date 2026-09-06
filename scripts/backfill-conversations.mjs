import { createHmac, createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server environment is unavailable");

const database = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [{ data: inquiries, error: inquiryError }, { data: existing, error: conversationError }] = await Promise.all([
  database.from("hmp_admin_inquiries").select("submission_id"),
  database.from("hmp_client_conversations").select("inquiry_id"),
]);
if (inquiryError || conversationError) throw new Error("Conversation backfill could not read the database");

const existingIds = new Set((existing || []).map((row) => row.inquiry_id));
const missing = (inquiries || []).filter((row) => !existingIds.has(row.submission_id));
if (missing.length) {
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const rows = missing.map((inquiry) => {
    const id = randomUUID();
    const nonce = randomBytes(24).toString("base64url");
    const token = createHmac("sha256", key)
      .update(`hmp-conversation:v1:${id}:${nonce}`)
      .digest("base64url");
    return {
      id,
      inquiry_id: inquiry.submission_id,
      access_token_hash: createHash("sha256").update(token).digest("hex"),
      token_nonce: nonce,
      token_expires_at: expiresAt,
    };
  });
  const { error } = await database.from("hmp_client_conversations").insert(rows);
  if (error) throw new Error(`Conversation backfill failed: ${error.code}`);
}

console.log(`Secure conversations ready: ${(existing || []).length + missing.length}; added: ${missing.length}`);
