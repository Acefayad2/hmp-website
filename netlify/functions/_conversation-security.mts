import { createHash, createHmac, randomBytes } from "node:crypto";

export const conversationToken = (conversationId: string, nonce: string) => {
  const secret = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("Conversation security is unavailable");
  return createHmac("sha256", secret)
    .update(`hmp-conversation:v1:${conversationId}:${nonce}`)
    .digest("base64url");
};

export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const newNonce = () => randomBytes(24).toString("base64url");

export const clientConversationUrl = (conversationId: string, nonce: string) =>
  `https://hmpeds.com/conversation#token=${conversationToken(conversationId, nonce)}`;

export const validBearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  return match?.[1] || "";
};

export const isSameOriginMutation = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
};
