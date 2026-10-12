import type { Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const database = (): SupabaseClient | null => {
  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
};

export const createPurgeHandler = ({ databaseFactory = database, now = () => Date.now() } = {}) => async () => {
  const client = databaseFactory();
  if (!client) throw new Error("Review database is unavailable");
  const cutoff = new Date(now() - 30 * 86400000).toISOString();
  const { data, error } = await client.from("hmp_admin_reviews")
    .select("id").not("deleted_at", "is", null).lte("deleted_at", cutoff)
    .order("deleted_at", { ascending: true }).limit(100);
  if (error) throw new Error(`Review cleanup lookup failed: ${error.code}`);
  const ids = (data || []).map((review) => review.id);
  if (!ids.length) return Response.json({ purged: 0 });
  const { error: deleteError } = await client.from("hmp_admin_reviews")
    .delete().in("id", ids).lte("deleted_at", cutoff);
  if (deleteError) throw new Error(`Review cleanup failed: ${deleteError.code}`);
  return Response.json({ purged: ids.length });
};

export default createPurgeHandler();
export const config: Config = { schedule: "15 7 * * *" };
