import type { Config } from "@netlify/functions";
import { getUser } from "./_admin-verification.mts";
import { createClient } from "@supabase/supabase-js";
import { isSameOriginMutation } from "./_conversation-security.mts";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

export const createMessageSignatureHandler = ({ getUserFn = getUser, databaseFactory = createClient } = {}) => async (request: Request) => {
  if (request.method !== "GET" && request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  const user = await getUserFn(request);
  const email = user?.email?.trim().toLowerCase();
  const allowed = (Netlify.env.get("HMP_ADMIN_EMAILS") || "").split(",").map(value => value.trim().toLowerCase());
  if (!email || !allowed.includes(email)) return json({ error: "Unauthorized" }, 401);
  if (request.method === "PUT" && !isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);

  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Message signature is unavailable" }, 503);
  const db = databaseFactory(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const table = db.from("hmp_admin_message_signature");

  if (request.method === "GET") {
    const { data, error } = await table.select("body,updated_at").eq("scope", "hmp").maybeSingle();
    if (error) return json({ error: "Message signature could not be loaded" }, 502);
    return json({ signature: data?.body || "", updatedAt: data?.updated_at || null });
  }

  const raw = await request.text();
  if (raw.length > 8000) return json({ error: "Signature is too long" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid signature" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as Record<string, unknown>).signature !== "string") {
    return json({ error: "Invalid signature" }, 400);
  }
  const signature = (body as { signature: string }).signature.trim();
  if (signature.length > 1000) return json({ error: "Signature must be 1,000 characters or fewer" }, 400);
  const { data, error } = await table.upsert({ scope: "hmp", body: signature, updated_at: new Date().toISOString(), updated_by: email }, { onConflict: "scope" }).select("body,updated_at").single();
  if (error || !data) return json({ error: "Message signature could not be saved" }, 502);
  return json({ signature: data.body, updatedAt: data.updated_at });
};

export default createMessageSignatureHandler();
export const config: Config = { path: "/api/hmp-message-signature" };
