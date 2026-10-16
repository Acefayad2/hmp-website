export const inquiryFilterTitles = {
  new: "Inquiries",
  booked: "Booked inquiries",
  closed: "Closed inquiries",
  archived: "Archived inquiries",
  deleted: "Deleted inquiries",
};

export function inquiryStatusGroup(status) {
  const value = String(status || "New").trim().toLowerCase();
  // Legacy Contacted/Quoted records stay visible without rewriting saved data.
  return ["booked", "closed", "archived", "deleted"].includes(value) ? value : "new";
}

export function inquiryGroups(inquiries) {
  const groups = { new: [], booked: [], closed: [], archived: [], deleted: [] };
  for (const item of inquiries) groups[inquiryStatusGroup(item.status)].push(item);
  return groups;
}
