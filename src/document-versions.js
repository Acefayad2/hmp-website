export const groupDocumentVersions = (rows = [], idKey = "id") => {
  const groups = new Map();
  for (const row of rows) {
    const key = row.revisionGroupId || row.revision_group_id || row[idKey];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()]
    .map((versions) => versions.sort((a, b) =>
      (Number(b.revisionNumber || b.revision_number || 1) - Number(a.revisionNumber || a.revision_number || 1))
      || String(b.createdAt || b.created_at || "").localeCompare(String(a.createdAt || a.created_at || ""))))
    .sort((a, b) => String(b[0].createdAt || b[0].created_at || "").localeCompare(String(a[0].createdAt || a[0].created_at || "")));
};
