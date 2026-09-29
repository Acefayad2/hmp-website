// These are client-supplied Google Forms. Responses remain in Google Forms.
document.querySelector("#client-google-forms").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-form]");
  if (!button) return;
  const card = button.closest(".client-form-card");
  const input = card.querySelector(".client-form-link");
  const status = card.querySelector("[role=status]");
  try {
    await navigator.clipboard.writeText(input.value);
    status.textContent = "Link copied. Paste it into your client message.";
  } catch {
    input.focus();
    input.select();
    status.textContent = "Copy was blocked. The link is selected so you can copy it manually.";
  }
});
