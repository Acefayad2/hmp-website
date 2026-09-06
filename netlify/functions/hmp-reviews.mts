import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const json = (
  body: unknown,
  status = 200,
  cacheControl = "no-store",
) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });

const allowedEmails = () =>
  (Netlify.env.get("HMP_ADMIN_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

let database: SupabaseClient | null = null;

const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return null;
  database = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return database;
};

const text = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const number = (value: unknown, fallback = 0) => {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeReview = (record: Record<string, unknown>) => ({
  id: record.id || "",
  reviewerName: record.reviewer_name || "",
  reviewerRole: record.reviewer_role || "",
  reviewText: record.review_text || "",
  service: record.service || "",
  rating: number(record.rating, 5),
  published: Boolean(record.published),
  isPlaceholder: Boolean(record.is_placeholder),
  displayOrder: number(record.display_order),
  createdAt: record.created_at || "",
  updatedAt: record.updated_at || "",
});

const cleanPayload = (body: Record<string, unknown>) => {
  const reviewerName = text(body.reviewerName, 120);
  const reviewText = text(body.reviewText, 1200);
  if (!reviewerName) throw new Error("Reviewer name is required");
  if (!reviewText) throw new Error("Review text is required");

  return {
    reviewer_name: reviewerName,
    reviewer_role: text(body.reviewerRole, 160) || null,
    review_text: reviewText,
    service: text(body.service, 160) || null,
    rating: Math.min(5, Math.max(1, Math.round(number(body.rating, 5)))),
    published: body.published !== false,
    is_placeholder: body.isPlaceholder === true,
    display_order: Math.min(
      100000,
      Math.max(-100000, Math.round(number(body.displayOrder))),
    ),
    updated_at: new Date().toISOString(),
  };
};

const requireAdmin = async () => {
  const user = await getUser();
  const email = user?.email?.toLowerCase();
  return email && allowedEmails().includes(email) ? user : null;
};

export default async (request: Request, _context: Context) => {
  const client = getDatabase();
  if (!client) return json({ error: "Review data is unavailable" }, 503);

  const url = new URL(request.url);
  const adminRequest = url.searchParams.get("admin") === "1";

  if (request.method === "GET") {
    const user = adminRequest ? await requireAdmin() : null;
    if (adminRequest && !user) return json({ error: "Unauthorized" }, 401);

    let query = client
      .from("hmp_admin_reviews")
      .select("*")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(100);
    if (!adminRequest) query = query.eq("published", true);

    const { data, error } = await query;
    if (error) {
      console.error("Supabase review read failed", error.code);
      return json({ error: "Review data is unavailable" }, 502);
    }

    return json(
      {
        reviews: (data || []).map((record) => normalizeReview(record)),
        updatedAt: new Date().toISOString(),
      },
      200,
      "no-store",
    );
  }

  const user = await requireAdmin();
  if (!user) return json({ error: "Unauthorized" }, 401);

  if (request.method === "POST" || request.method === "PATCH") {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }

    let payload: ReturnType<typeof cleanPayload>;
    try {
      payload = cleanPayload(body);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "Review is invalid" },
        400,
      );
    }

    if (request.method === "POST") {
      const { data, error } = await client
        .from("hmp_admin_reviews")
        .insert({ ...payload, created_by: user.email || "HMP Admin" })
        .select("*")
        .single();
      if (error) {
        console.error("Supabase review create failed", error.code);
        return json({ error: "Review could not be created" }, 502);
      }
      return json({ ok: true, review: normalizeReview(data) }, 201);
    }

    const id = text(body.id, 36);
    if (!uuidPattern.test(id)) return json({ error: "Invalid review" }, 400);
    const { data, error } = await client
      .from("hmp_admin_reviews")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      console.error("Supabase review update failed", error.code);
      return json(
        {
          error:
            error.code === "PGRST116"
              ? "Review not found"
              : "Review could not be saved",
        },
        error.code === "PGRST116" ? 404 : 502,
      );
    }
    return json({ ok: true, review: normalizeReview(data) });
  }

  if (request.method === "DELETE") {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const id = text(body.id, 36);
    if (!uuidPattern.test(id)) return json({ error: "Invalid review" }, 400);
    const { error } = await client
      .from("hmp_admin_reviews")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("Supabase review delete failed", error.code);
      return json({ error: "Review could not be deleted" }, 502);
    }
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config: Config = {
  path: "/api/hmp-reviews",
};
