export const insertMessageSignature = (draft, signature, maxLength = 4000) => {
  const text = String(signature || "").trim();
  const current = String(draft || "");
  if (!text) return { message: current, error: "Save a signature first." };
  if (current.trimEnd().endsWith(text)) return { message: current, error: "Signature is already in this reply." };
  const message = `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${text}`;
  if (message.length > maxLength) return { message: current, error: "This reply is too long to add the signature." };
  return { message, error: "" };
};

export const insertFormattedMessageSignature = (draft, signature, maxLength, draftFormatting = [], signatureFormatting = []) => {
  const result = insertMessageSignature(draft, signature, maxLength);
  if (result.error) return {...result, formatting: draftFormatting};
  const draftEnd = String(draft || "").trimEnd().length;
  const signatureStart = result.message.length - String(signature || "").trim().length;
  return {
    ...result,
    formatting: [
      ...draftFormatting.map(run => ({...run, end: Math.min(run.end, draftEnd)})).filter(run => run.end > run.start),
      ...signatureFormatting.map(run => ({...run, start: run.start + signatureStart, end: run.end + signatureStart})),
    ],
  };
};
