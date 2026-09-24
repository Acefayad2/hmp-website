export const inquiryFilterTitles = {
  all: "Event inquiries",
  new: "New inquiries",
  upcoming: "Upcoming event inquiries",
  largest: "Largest event inquiries",
};

export function inquiryGroups(inquiries, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const largest = inquiries.reduce((max, item) => {
    const count = Number(item.guestCount);
    return Number.isFinite(count) ? Math.max(max, count) : max;
  }, 0);
  return {
    all: inquiries,
    new: inquiries.filter((item) => String(item.status).toLowerCase() === "new"),
    upcoming: inquiries.filter((item) => {
      const value = item.celebrationDate;
      if (!value) return false;
      // Date-only form values represent the event's calendar day, not UTC midnight.
      const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
      return date >= today;
    }),
    largest: largest > 0 ? inquiries.filter((item) => Number(item.guestCount) === largest) : [],
  };
}
