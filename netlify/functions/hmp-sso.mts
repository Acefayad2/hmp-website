import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";

const SSO_COOKIE = "hmp_admin_sso";

const allowedEmails = () =>
  (Netlify.env.get("HMP_ADMIN_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const cookieValue = (request: Request, name: string) => {
  const entry = (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
};

const tokenLifetime = (token: string) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { exp?: number };
    const remaining = Math.floor(Number(payload.exp || 0) - Date.now() / 1000);
    return Math.max(1, Math.min(3600, remaining));
  } catch {
    return 900;
  }
};

const response = (body: unknown, status: number, cookie?: string) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
      "X-Content-Type-Options": "nosniff",
    },
  });

export default async (request: Request, _context: Context) => {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin) {
    return response({ error: "Invalid request origin" }, 403, "");
  }

  const clearCookie = `${SSO_COOKIE}=; Domain=hmpeds.com; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  if (request.method === "DELETE") return response({ ok: true }, 200, clearCookie);
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405, "");

  const user = await getUser();
  const email = user?.email?.trim().toLowerCase() || "";
  const authorization = request.headers.get("authorization") || "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const identityToken = cookieValue(request, "nf_jwt") || bearerToken;
  if (!identityToken || !email || !allowedEmails().includes(email)) {
    return response({ error: "Unauthorized" }, 401, clearCookie);
  }

  const cookie = `${SSO_COOKIE}=${encodeURIComponent(identityToken)}; Domain=hmpeds.com; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${tokenLifetime(identityToken)}`;
  return response({ ok: true, email }, 200, cookie);
};

export const config: Config = {
  path: "/api/hmp-sso",
};
