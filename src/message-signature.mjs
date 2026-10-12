export const insertMessageSignature = (draft, signature, maxLength = 4000) => {
  const text = String(signature || "").trim();
  const current = String(draft || "");
  if (!text) return { message: current, error: "Save a signature first." };
  if (current.trimEnd().endsWith(text)) return { message: current, error: "Signature is already in this reply." };
  const message = `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${text}`;
  if (message.length > maxLength) return { message: current, error: "This reply is too long to add the signature." };
  return { message, error: "" };
};
