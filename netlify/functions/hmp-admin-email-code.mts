import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomInt } from "node:crypto";
import { isSameOriginMutation } from "./_conversation-security.mts";
import {
  clearAdminSecondFactorCookie,
  isAdminSecondFactorVerified,
  isAllowedAdmin,
  verifiedAdminCookie,
} from "./_admin-second-factor.mts";

const table = "hmp_admin_email_challenges";
const minute = 60_000;
const hour = 60 * minute;
const codeLifetime = 10 * minute;
const json = (body: unknown, status = 200, cookie?: string) => Response.json(body, {
  status,
  headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(cookie ? { "Set-Cookie": cookie } : {}),
  },
});

let database: SupabaseClient | null = null;
const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return database;
};

export const hashAdminCode = (userId: string, code: string, secret: string) =>
  createHmac("sha256", secret).update(`hmp-admin-code:v1:${userId}:${code}`).digest("hex");

export const createAdminEmailCodeHandler = ({
  getUserFn = getUser,
  databaseFactory = getDatabase,
  fetchFn = fetch,
  nowFn = Date.now,
} = {}) => async (request: Request) => {
  if (!["GET", "POST", "DELETE"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
  if (request.method !== "GET" && !isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
  if (request.method === "DELETE") return json({ ok: true }, 200, clearAdminSecondFactorCookie());

  const user = await getUserFn();
  if (!isAllowedAdmin(user)) return json({ error: "Unauthorized" }, 401);
  const secret = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const client = databaseFactory();
  if (!secret || !client) return json({ error: "Admin verification is temporarily unavailable." }, 503);
  if (request.method === "GET") return json({ verified: isAdminSecondFactorVerified(request, user, secret) });
  if (isAdminSecondFactorVerified(request, user, secret)) return json({ verified: true });

  const raw = await request.text();
  if (raw.length > 100) return json({ error: "Invalid request" }, 400);
  let body: { action?: string; code?: string };
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid request" }, 400); }
  if (!body || typeof body !== "object") return json({ error: "Invalid request" }, 400);
  const userId = user!.id!;
  const now = nowFn();

  if (body.action === "send") {
    const apiKey = Netlify.env.get("RESEND_API_KEY");
    const from = Netlify.env.get("HMP_INQUIRY_FROM_EMAIL") || Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
    if (!apiKey || !from) return json({ error: "Admin verification email is not configured." }, 503);
    const { data: previous, error: readError } = await client.from(table).select("*").eq("user_id", userId).maybeSingle();
    if (readError) return json({ error: "Could not prepare a verification code." }, 503);
    if (previous && now - Date.parse(previous.sent_at) < minute)
      return json({ error: "Please wait a minute before requesting another code." }, 429);
    const sameWindow = previous && now - Date.parse(previous.window_started_at) < hour;
    if (sameWindow && previous.sent_count >= 5)
      return json({ error: "Too many codes requested. Please try again in an hour." }, 429);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const sentAt = new Date(now).toISOString();
    const row = {
      user_id: userId,
      code_hash: hashAdminCode(userId, code, secret),
      attempts: 0,
      sent_at: sentAt,
      expires_at: new Date(now + codeLifetime).toISOString(),
      window_started_at: sameWindow ? previous.window_started_at : sentAt,
      sent_count: sameWindow ? previous.sent_count + 1 : 1,
    };
    const query = previous
      ? client.from(table).update(row).eq("user_id", userId).eq("sent_at", previous.sent_at)
      : client.from(table).insert(row);
    const { data: saved, error: saveError } = await query.select("user_id").maybeSingle();
    if (saveError || !saved) return json({ error: "Please wait and request a new code." }, 429);
    const response = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [user!.email],
        subject: "Your HMP Admin sign-in code",
        text: `Your HMP Admin sign-in code is ${code}. It expires in 10 minutes. If you did not request this, change your password and contact HMP.`,
        html: `<div style="font-family:Georgia,serif;color:#4d3232;padding:24px"><h1>HMP Admin sign-in</h1><p>Your verification code is:</p><p style="font-size:32px;letter-spacing:8px;font-weight:bold">${code}</p><p>This code expires in 10 minutes. If you did not request it, change your password and contact HMP.</p></div>`,
      }),
    }).catch(() => null);
    if (!response?.ok) {
      await client.from(table).update({ code_hash: null, sent_at: new Date(0).toISOString() })
        .eq("user_id", userId).eq("code_hash", row.code_hash);
      return json({ error: "Code email could not be sent. Please try again." }, 502);
    }
    return json({ sent: true, expiresInSeconds: 600 });
  }

  if (body.action === "verify") {
    const code = body.code;
    if (typeof code !== "string" || !/^\d{6}$/.test(code))
      return json({ error: "Enter the six-digit code from your email." }, 400);
    const { data: row, error: readError } = await client.from(table)
      .select("code_hash,attempts,expires_at").eq("user_id", userId).maybeSingle();
    if (readError) return json({ error: "Verification is temporarily unavailable." }, 503);
    if (!row?.code_hash || row.attempts >= 5 || Date.parse(row.expires_at) <= now)
      return json({ error: "This code expired or has been used. Request a new one." }, 401);
    const matched = row.code_hash === hashAdminCode(userId, code, secret);
    const { data: consumed, error: updateError } = await client.from(table)
      .update(matched ? { code_hash: null, attempts: 5 } : { attempts: row.attempts + 1 })
      .eq("user_id", userId).eq("code_hash", row.code_hash).eq("attempts", row.attempts)
      .gt("expires_at", new Date(now).toISOString()).select("user_id").maybeSingle();
    if (updateError) return json({ error: "Verification is temporarily unavailable." }, 503);
    if (!consumed) return json({ error: "This code changed. Please try again." }, 409);
    if (!matched) return json({ error: "That code is incorrect." }, 401);
    return json({ verified: true }, 200, verifiedAdminCookie(user, secret, now));
  }
  return json({ error: "Invalid request" }, 400);
};

export default createAdminEmailCodeHandler();
export const config: Config = { path: "/api/hmp-admin-email-code" };
