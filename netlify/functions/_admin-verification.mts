import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getUser as identityUser } from "@netlify/identity";

export const verificationCookie = "hmp_admin_verified";
export const challengeCookie = "hmp_admin_challenge";
export const verificationLifetime = 3600;
export const securitySecret = () => Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
export const readCookie = (request: Request, name: string) => {
  const entry = (request.headers.get("cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  try { return entry ? decodeURIComponent(entry.slice(name.length + 1)) : ""; } catch { return ""; }
};
const mac = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("hex");
export const codeHash = (secret: string, user: {id:string;email?:string}, nonce: string, code: string) =>
  mac(secret, `hmp-admin-code:v1:${user.id}:${user.email?.toLowerCase()}:${nonce}:${code}`);
export const issueVerification = (user: {id:string;email?:string}, secret = securitySecret(), now = Date.now()) => {
  if (!secret) throw new Error("Verification unavailable");
  const payload = Buffer.from(JSON.stringify({id:user.id,email:user.email?.toLowerCase(),expires:now+verificationLifetime*1000,nonce:randomUUID()})).toString("base64url");
  return `${payload}.${mac(secret, `hmp-admin-verified:v1:${payload}`)}`;
};
export const hasAdminVerification = (request: Request, user: {id:string;email?:string}, secret = securitySecret(), now = Date.now()) => {
  if (!secret || !user?.id || !user.email) return false;
  const token = readCookie(request, verificationCookie);
  if (token.length > 2000) return false;
  const [payload, signature, extra] = token.split(".");
  if (extra !== undefined || !payload || !/^[a-f0-9]{64}$/.test(signature || "")) return false;
  const expected = mac(secret, `hmp-admin-verified:v1:${payload}`);
  if (!timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) return false;
  try {
    const proof = JSON.parse(Buffer.from(payload,"base64url").toString());
    return proof.id===user.id && proof.email===user.email.toLowerCase() && Number.isSafeInteger(proof.expires) && proof.expires>now && proof.expires<=now+verificationLifetime*1000;
  } catch { return false; }
};
export const cookieHeader = (request: Request, name: string, value: string, maxAge: number) => {
  const host = new URL(request.url).hostname;
  const domain = host === "hmpeds.com" || host.endsWith(".hmpeds.com") ? "; Domain=hmpeds.com" : "";
  return `${name}=${encodeURIComponent(value)}${domain}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
};
// Every Admin data endpoint must check both Identity and the email-code proof.
export async function getUser(request: Request) {
  const user = await identityUser();
  return user && hasAdminVerification(request,user) ? user : null;
}
