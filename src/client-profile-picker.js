import { agreementRequest } from "../agreement-ui.mjs";

let profilesPromise;

export const clientProfileValues = (thread = {}) => ({
  inquiryId: thread.inquiryId || "",
  conversationId: thread.id || "",
  clientName: thread.clientName || "",
  clientEmail: thread.clientEmail || "",
  clientPhone: thread.clientPhone || "",
  eventName: thread.service || "",
  eventDate: thread.celebrationDate || "",
  eventLocation: thread.eventLocation || "",
  eventAddress: thread.eventLocation || "",
  services: thread.service || "",
  scopeOfWork: thread.service || "",
  serviceStartTime: thread.startTime || "",
  serviceEndTime: thread.endTime || "",
});

export const loadClientProfiles = async () => {
  profilesPromise ||= agreementRequest("/api/hmp-messages")
    .then(data => (data.threads || []).filter(thread => !thread.deletedAt));
  try { return await profilesPromise; }
  catch (error) { profilesPromise = null; throw error; }
};

export function mountClientProfilePicker(container, {
  threads,
  selectedInquiryId = "",
  disabled = false,
  onSelect,
} = {}) {
  container.querySelector("[data-client-profile-picker]")?.remove();
  const panel = document.createElement("section");
  panel.className = "agreement-panel client-profile-picker";
  panel.dataset.clientProfilePicker = "";
  panel.innerHTML = `<label class="agreement-field"><strong>Client profile (optional)</strong><select><option value="">Start without a client profile</option></select><small>Choose an existing Client Hub to fill its contact and event details. You can edit every field afterward. If you start without one, sending an invoice or agreement can create the Client Hub later.</small></label><p class="agreement-status" role="status"></p>`;
  const select = panel.querySelector("select");
  select.disabled = disabled;
  const status = panel.querySelector("[role=status]");
  const populate = rows => {
    for (const thread of rows) {
      const option = document.createElement("option");
      option.value = thread.inquiryId || thread.id;
      option.textContent = `${thread.clientName} · ${thread.service || "Event"} · ${thread.celebrationDate || "Date not set"}`;
      option.dataset.threadId = thread.id;
      select.append(option);
    }
    select.value = rows.some(thread => (thread.inquiryId || thread.id) === selectedInquiryId) ? selectedInquiryId : "";
    select.onchange = () => {
      const thread = rows.find(item => (item.inquiryId || item.id) === select.value);
      if (!thread) return onSelect?.(null);
      onSelect?.(clientProfileValues(thread), thread);
      status.textContent = `Filled from ${thread.clientName}'s Client Hub. Review and edit before saving.`;
    };
  };
  const anchor = container.querySelector("article, .agreement-grid, [data-profile-picker-anchor]");
  if (anchor) anchor.before(panel); else container.prepend(panel);
  if (threads) populate(threads);
  else {
    status.textContent = "Loading client profiles…";
    loadClientProfiles().then(rows => { status.textContent = ""; populate(rows); })
      .catch(error => { status.textContent = error.message || "Client profiles could not be loaded. You can still enter the details manually."; });
  }
  return panel;
}

export function applyClientProfile(form, profile, fieldMap) {
  if (!profile) return;
  for (const [profileKey, target] of Object.entries(fieldMap)) {
    const field = typeof target === "string" ? form.querySelector(target) : target;
    if (!field || !("value" in field)) continue;
    field.value = profile[profileKey] || "";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
