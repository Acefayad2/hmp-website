import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_MFA_COOKIE = "__Host-hmp_admin_mfa";
const SESSION_SECONDS = 12 * 60 * 60;

type AdminUser = { id?: string; email?: string } | null | undefined;

export const isAllowedAdmin = (user: AdminUser) => {
  const email = user?.email?.trim().toLowerCase();
  return Boolean(user?.id && email && (Netlify.env.get("HMP_ADMIN_EMAILS") || "")
    .split(",").some((allowed) => allowed.trim().toLowerCase() === email));
};

const signature = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(`hmp-admin-mfa:v1:${payload}`).digest("hex");

const readCookie = (request: Request) => {
  const part = (request.headers.get("cookie") || "").split(";")
    .map((value) => value.trim()).find((value) => value.startsWith(`${ADMIN_MFA_COOKIE}=`));
  return part?.slice(ADMIN_MFA_COOKIE.length + 1) || "";
};

export const isAdminSecondFactorVerified = (
  request: Request,
  user: AdminUser,
  secret = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  now = Date.now(),
) => {
  if (!isAllowedAdmin(user) || !secret) return false;
  const [payload, mac, extra] = readCookie(request).split(".");
  if (!payload || !mac || extra || !/^[a-f0-9]{64}$/.test(mac)) return false;
  const expected = Buffer.from(signature(payload, secret), "hex");
  if (!timingSafeEqual(Buffer.from(mac, "hex"), expected)) return false;
  try {
    const record = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      id?: string; email?: string; expires?: number;
    };
    return record.id === user?.id && record.email === user?.email?.trim().toLowerCase()
      && Number.isSafeInteger(record.expires) && record.expires! > now
      && record.expires! <= now + SESSION_SECONDS * 1000;
  } catch {
    return false;
  }
};

export const verifiedAdminCookie = (
  user: AdminUser,
  secret: string,
  now = Date.now(),
) => {
  if (!isAllowedAdmin(user) || !secret) throw new Error("Admin verification is unavailable.");
  const payload = Buffer.from(JSON.stringify({
    id: user!.id,
    email: user!.email!.trim().toLowerCase(),
    expires: now + SESSION_SECONDS * 1000,
  })).toString("base64url");
  return `${ADMIN_MFA_COOKIE}=${payload}.${signature(payload, secret)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
};

export const clearAdminSecondFactorCookie = () =>
  `${ADMIN_MFA_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export const adminSecondFactorRequired = () => Response.json(
  { error: "Enter the code sent to your admin email to continue.", code: "MFA_REQUIRED" },
  { status: 401, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
);
