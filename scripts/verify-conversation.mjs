import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const previewUrl = process.env.HMP_CONVERSATION_TEST_ORIGIN;
if (!url || !key || !previewUrl) throw new Error("Conversation test environment is incomplete");

const database = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: conversation, error } = await database
  .from("hmp_client_conversations")
  .select("id,token_nonce")
  .limit(1)
  .single();
if (error || !conversation) throw new Error("No conversation is available for verification");

const token = createHmac("sha256", key)
  .update(`hmp-conversation:v1:${conversation.id}:${conversation.token_nonce}`)
  .digest("base64url");
const response = await fetch(`${previewUrl}/api/hmp-conversation`, {
  headers: { Authorization: `Bearer ${token}` },
});
const payload = await response.json();
if (!response.ok) throw new Error(`Conversation endpoint failed with ${response.status}`);
if (!payload.conversation?.clientName || !Array.isArray(payload.messages)) {
  throw new Error("Conversation response is incomplete");
}
const serialized = JSON.stringify(payload);
for (const privateField of ["email", "phone", "internalNotes", "internal_notes"]) {
  if (serialized.includes(`\"${privateField}\"`)) {
    throw new Error(`Conversation response exposed ${privateField}`);
  }
}
console.log("Secure conversation endpoint verified with a valid private token");
