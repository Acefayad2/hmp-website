export const reviewServices = ["General HMP experience", "Event Accessories", "Guest Seating Experience", "Money Table Services", "Welcome Sign Services", "LED Signage"];
export const reviewConsent = "I allow HMP to display my review, chosen display name, rating, and service details on its website after admin approval. My email address will not be published.";
const text = (value, max, label, required = true) => {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > max) throw new Error(`${label} is required and must be ${max} characters or fewer.`);
  return result;
};
export function reviewContact(body) {
  const clientName = text(body.clientName, 120, "Client name");
  const clientEmail = text(body.clientEmail, 320, "Client email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) throw new Error("Enter a valid client email.");
  return {client_name:clientName, client_email:clientEmail};
}
export function reviewSubmission(body) {
  if (body.consent !== true) throw new Error("Please give permission to publish your review after approval.");
  const services = Array.isArray(body.services) ? [...new Set(body.services)] : [];
  if (!services.length || services.some(service => !reviewServices.includes(service))) throw new Error("Select at least one service.");
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) throw new Error("Choose a rating from 1 to 5.");
  return {reviewer_name:text(body.reviewerName,120,"Display name"), reviewer_role:text(body.reviewerRole,160,"Client detail",false),
    review_text:text(body.reviewText,1200,"Review"), service:services.join(", "), rating:body.rating};
}
