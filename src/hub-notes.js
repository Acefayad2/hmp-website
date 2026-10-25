// Unsaved text stays in memory per inquiry, never in shared browser storage.
export const mountHubNotes = ({ form, input, saveButton, reloadButton, status, loadThreads, onSaved }) => {
  const drafts = new Map();
  let currentId = "";
  const dirty = draft => draft.text !== draft.saved;
  const paint = () => {
    const draft = drafts.get(currentId);
    if (!draft) return;
    if (input.value !== draft.text) input.value = draft.text;
    input.disabled = draft.busy;
    saveButton.disabled = draft.busy || !dirty(draft);
    reloadButton.disabled = draft.busy;
    status.textContent = draft.message || (dirty(draft) ? "Unsaved changes — select Save notes. Switching tabs keeps your text until you leave this page." : "");
  };
  const open = thread => {
    currentId = thread.inquiryId;
    const previous = drafts.get(currentId);
    if (!previous || (!dirty(previous) && !previous.busy)) {
      const text = thread.internalNotes || "";
      drafts.set(currentId, { text, saved: text, version: thread.notesVersion ?? null, busy: false, message: previous?.message || "" });
    }
    paint();
  };
  input.addEventListener("input", () => {
    const draft = drafts.get(currentId);
    if (!draft) return;
    draft.text = input.value;
    draft.message = "";
    paint();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const id = currentId, draft = drafts.get(id);
    if (!draft || draft.busy || !dirty(draft) || !form.reportValidity()) return;
    draft.busy = true;
    draft.message = "Saving private notes…";
    paint();
    try {
      const response = await fetch("/api/hmp-dashboard", {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "save-notes", internalNotes: draft.text, expectedVersion: draft.version }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Notes could not be saved. Your changes are still here.");
      draft.text = draft.saved = data.inquiry.internalNotes;
      draft.version = data.inquiry.notesVersion;
      draft.message = "Notes saved privately for the HMP Admin team. Nothing was sent to the client.";
      onSaved(data.inquiry);
    } catch (error) {
      draft.message = error.message || "Notes could not be saved. Please try again.";
    } finally {
      draft.busy = false;
      if (currentId === id) paint();
    }
  });
  reloadButton.addEventListener("click", async () => {
    const id = currentId, draft = drafts.get(id);
    if (!draft || draft.busy) return;
    if (dirty(draft) && !window.confirm("Discard your unsaved notes and load the latest saved version? Copy any text you want to keep first.")) return;
    draft.busy = true;
    draft.message = "Loading saved notes…";
    paint();
    try {
      const threads = await loadThreads();
      const thread = threads.find(item => item.inquiryId === id);
      if (!thread) throw new Error("This client hub is unavailable. Your text has been kept.");
      draft.text = draft.saved = thread.internalNotes || "";
      draft.version = thread.notesVersion ?? null;
      draft.message = "Latest saved notes loaded.";
    } catch (error) {
      draft.message = error.message || "Notes could not be loaded. Your text has been kept.";
    } finally {
      draft.busy = false;
      if (currentId === id) paint();
    }
  });
  window.addEventListener("beforeunload", event => {
    if ([...drafts.values()].some(dirty)) { event.preventDefault(); event.returnValue = ""; }
  });
  return { open };
};
