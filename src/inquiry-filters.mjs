export const inquiryFilterTitles = {
  inquiries: "Inquiries",
  booked: "Booked inquiries",
  closed: "Closed inquiries",
  archived: "Archived inquiries",
  deleted: "Deleted inquiries",
};

export function inquiryGroups(inquiries) {
  const groups = Object.fromEntries(Object.keys(inquiryFilterTitles).map((key) => [key, []]));
  for (const item of inquiries) {
    const status = String(item.status || "New").toLowerCase();
    const group = ["booked", "closed", "archived", "deleted"].includes(status) ? status : "inquiries";
    groups[group].push(item);
  }
  return groups;
}
