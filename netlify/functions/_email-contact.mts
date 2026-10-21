// One verified mailbox for HMP correspondence; login/authorization settings stay separate.
const setting = (name: string) => typeof Netlify === "undefined" ? undefined : Netlify.env.get(name);
const communicationEmail = () => setting("HMP_COMMUNICATION_EMAIL")?.trim() || "";
export const hmpReplyTo = () => communicationEmail() || setting("HMP_CONTRACT_REPLY_TO") || setting("HMP_INVOICE_REPLY_TO") || "info@hmpeds.com";
export const hmpAlertRecipient = () => communicationEmail() || setting("HMP_INQUIRY_ADMIN_EMAIL") || "info@hmpeds.com";
export const hmpSender = (kind: "inquiry" | "invoice" | "contract" = "inquiry") => {
  const shared = communicationEmail();
  if (shared) return `HMP Event Concierge <${shared}>`;
  const specific = kind === "contract" ? "HMP_CONTRACT_FROM_EMAIL" : kind === "invoice" ? "HMP_INVOICE_FROM_EMAIL" : "HMP_INQUIRY_FROM_EMAIL";
  return setting(specific) || setting("HMP_INVOICE_FROM_EMAIL") || "";
};
