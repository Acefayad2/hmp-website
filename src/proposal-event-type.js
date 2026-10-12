export const proposalEventType = (value) => {
  const label = String(value || "").trim();
  if (!label || label !== label.toLowerCase()) return label;
  return label.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
};
