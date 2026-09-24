import type { SupabaseClient } from "@supabase/supabase-js";

/** Call only after authorizing the exact conversation IDs. Never silently truncate. */
export async function readMessageHistory(client: SupabaseClient, conversationIds: string[], columns: string) {
  const rows = [];
  const pageSize = 500;
  if (!conversationIds.length) return { data: rows, error: null };
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("hmp_client_messages")
      .select(columns).in("conversation_id", conversationIds)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
}
