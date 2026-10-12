import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { isSameOriginMutation } from "./_conversation-security.mts";
import { reviewContact, reviewConsent, reviewSubmission } from "../../review-request-schema.mjs";
import { reviewHash, reviewToken } from "./hmp-review-requests.mts";

const source = "Universal review link";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export const createPublicReviewHandler = ({ databaseFactory = createClient } = {}) => async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isSameOriginMutation(request)) return json({ error: "Invalid request origin" }, 403);
  const raw = await request.text();
  if (raw.length > 12000) return json({ error: "Request is too large" }, 413);
  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
  if (body.website) return json({ submitted: true }, 201);
  if (!uuid.test(body.requestId || "")) return json({ error: "Invalid request ID" }, 400);

  let review: ReturnType<typeof reviewSubmission>;
  let contact: ReturnType<typeof reviewContact>;
  try {
    review = reviewSubmission(body);
    contact = reviewContact({ clientName: review.reviewer_name, clientEmail: body.clientEmail });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid review" }, 400);
  }

  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Review form is unavailable" }, 503);
  const db = databaseFactory(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const tokenHash = reviewHash(reviewToken(body.requestId, key));
  try {
    const { error: insertError } = await db.from("hmp_review_requests").upsert({
      id: body.requestId,
      ...contact,
      created_by: source,
      token_hash: tokenHash,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (insertError) return json({ error: "Your review could not be saved. Please try again." }, 502);
    const { data: row, error: readError } = await db.from("hmp_review_requests")
      .select("client_name,client_email,created_by,expires_at,submitted_at")
      .eq("id", body.requestId).single();
    if (readError || !row) return json({ error: "Your review could not be saved. Please try again." }, 502);
    if (row.created_by !== source || row.client_name !== contact.client_name || row.client_email !== contact.client_email) {
      return json({ error: "This request belongs to different client details. Please reload the form." }, 409);
    }
    if (row.submitted_at) return json({ submitted: true });
    if (Date.parse(row.expires_at) <= Date.now()) return json({ error: "This submission expired. Please reload the form." }, 410);
    const { error: saveError } = await db.rpc("hmp_submit_requested_review", {
      p_token_hash: tokenHash,
      p_review: review,
      p_consent: reviewConsent,
    });
    if (saveError) return json({ error: "Your review could not be saved. Please try again." }, 502);
    return json({ submitted: true }, 201);
  } catch {
    return json({ error: "Your review could not be saved. Please try again." }, 502);
  }
};

export default createPublicReviewHandler();
export const config: Config = {
  path: "/api/hmp-public-review",
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
