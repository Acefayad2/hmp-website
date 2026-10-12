export const normalizeCalendarUrl = (value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
};

export const appendLinkedText = (element, value) => {
  const text = String(value || "");
  const pattern = /https:\/\/[^\s<>]+/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    element.append(document.createTextNode(text.slice(lastIndex, start)));
    const candidate = match[0].replace(/[.,!?;:)]+$/, "");
    const url = normalizeCalendarUrl(candidate);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = candidate;
      element.append(link);
      element.append(document.createTextNode(match[0].slice(candidate.length)));
    } else {
      element.append(document.createTextNode(match[0]));
    }
    lastIndex = start + match[0].length;
  }
  element.append(document.createTextNode(text.slice(lastIndex)));
  return element;
};
