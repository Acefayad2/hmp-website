export const documentGroupId = (row: { id: string; revision_group_id?: string | null }) =>
  row.revision_group_id || row.id;

export async function nextRevision(db: any, table: string, row: { id: string; revision_group_id?: string | null; revision_number?: number }) {
  const groupId = documentGroupId(row);
  const { data, error } = await db.from(table).select("revision_number")
    .eq("revision_group_id", groupId).order("revision_number", { ascending: false }).limit(1);
  if (error) throw new Error("Version history is unavailable");
  return { groupId, number: Math.max(Number(row.revision_number) || 1, Number(data?.[0]?.revision_number) || 1) + 1 };
}
