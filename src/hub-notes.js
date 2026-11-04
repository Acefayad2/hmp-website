import {setRichField, richFieldFormatting} from "./rich-text-fields.js";
import {richTextHTML} from "../text-formatting.mjs";
import {readInternalNotes} from "../internal-note-history.mjs";
// Unsaved text stays in memory per inquiry, never in shared browser storage.
export const mountHubNotes = ({ form, input, history, saveButton, reloadButton, status, loadThreads, onSaved }) => {
  const drafts = new Map();
  let currentId = "";
  setRichField(input);
  const dirty = draft => draft.text !== draft.saved || Boolean(draft.editId) || Boolean(draft.formatting?.length);
  const resetEditor = draft => { input.value = draft.text; setRichField(input,draft.formatting || []); };
  const renderHistory = draft => {
    if (!history) return;
    history.replaceChildren();
    const entries = draft.entries || readInternalNotes(draft.history);
    if (!entries.length) {history.textContent = "No saved notes yet."; return;}
    for (const note of entries) {
      const card = document.createElement("details"), title = document.createElement("summary"), content = document.createElement("div"), actions = document.createElement("div");
      card.className = "hub-note-card";
      title.textContent = `${note.createdAt ? new Date(note.createdAt).toLocaleString() : "Earlier note"}${note.author ? ` · ${note.author}` : ""} — ${note.text.slice(0,90)}${note.text.length>90?"…":""}`;
      content.innerHTML = richTextHTML(note.text,note.formatting);
      actions.className = "hub-notes-actions";
      for (const label of ["Edit","Delete"]) {
        const button = document.createElement("button");button.type="button";button.className="secondary-button";button.textContent=label;button.disabled=draft.busy;
        button.addEventListener("click",()=>{
          if (draft.busy) return;
          if (label === "Delete") {if(window.confirm("Delete this internal note? This cannot be undone.")) void saveNote("delete-note",note.id);return;}
          if (dirty(draft) && !window.confirm("Replace your unsaved draft with this note for editing?")) return;
          draft.editId=note.id;draft.text=note.text;draft.formatting=note.formatting || [];draft.message="Editing saved note. Select Save changes when finished.";
          resetEditor(draft);paint();input.focus();
        });actions.append(button);
      }
      card.append(title,content,actions);history.append(card);
    }
  };
  const cancel = document.createElement("button");cancel.type="button";cancel.className="secondary-button";cancel.textContent="Cancel edit";cancel.hidden=true;
  saveButton.after?.(cancel);
  cancel.addEventListener("click",()=>{const draft=drafts.get(currentId);if(!draft || draft.busy)return;draft.editId=null;draft.text="";draft.formatting=[];draft.message="";resetEditor(draft);paint();});
  const paint = () => {
    const draft = drafts.get(currentId);
    if (!draft) return;
    if (input.value !== draft.text) input.value = draft.text;
    renderHistory(draft);
    saveButton.textContent = draft.editId ? "Save changes" : "Add note";
    cancel.hidden = !draft.editId;cancel.disabled=draft.busy;
    if(input.disabled !== draft.busy) input.disabled = draft.busy;
    saveButton.disabled = draft.busy || !dirty(draft);
    reloadButton.disabled = draft.busy;
    status.textContent = draft.message || (dirty(draft) ? `Unsaved note — select ${draft.editId ? "Save changes" : "Add note"}. Switching tabs keeps your text until you leave this page.` : "");
  };
  const open = thread => {
    currentId = thread.inquiryId;
    const previous = drafts.get(currentId);
    if (!previous || (!dirty(previous) && !previous.busy)) {
      drafts.set(currentId, { text:"", saved:"", history:thread.internalNotes || "", entries:thread.internalNoteEntries, formatting:[], editId:null, version: thread.notesVersion ?? null, busy: false, message: previous?.message || "" });
    }
    resetEditor(drafts.get(currentId));
    paint();
  };
  input.addEventListener("input", () => {
    const draft = drafts.get(currentId);
    if (!draft) return;
    draft.text = input.value;
    draft.formatting = richFieldFormatting(input);
    draft.message = "";
    paint();
  });
  const saveNote = async (action, noteId) => {
    const id = currentId, draft = drafts.get(id);
    if (!draft || draft.busy || (action !== "delete-note" && (!dirty(draft) || !form.reportValidity()))) return;
    draft.busy = true;
    draft.message = "Saving private notes…";
    paint();
    try {
      const response = await fetch("/api/hmp-dashboard", {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, noteId, internalNotes: draft.text, formatting:draft.formatting || [], expectedVersion: draft.version }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Notes could not be saved. Your changes are still here.");
      draft.history = data.inquiry.internalNotes;
      draft.entries = data.inquiry.internalNoteEntries;
      if(action !== "delete-note" || draft.editId === noteId) {draft.text = draft.saved = "";draft.editId=null;draft.formatting=[];}
      if(currentId===id)resetEditor(draft);
      draft.version = data.inquiry.notesVersion;
      draft.message = "Notes saved privately for the HMP Admin team. Nothing was sent to the client.";
      onSaved(data.inquiry);
    } catch (error) {
      draft.message = error.message || "Notes could not be saved. Please try again.";
    } finally {
      draft.busy = false;
      if (currentId === id) paint();
    }
  };
  form.addEventListener("submit", event => {event.preventDefault();const draft=drafts.get(currentId);return saveNote(draft?.editId ? "edit-note" : "append-notes",draft?.editId);});
  reloadButton.addEventListener("click", async () => {
    const id = currentId, draft = drafts.get(id);
    if (!draft || draft.busy) return;
    draft.busy = true;
    draft.message = "Loading saved notes…";
    paint();
    try {
      const threads = await loadThreads();
      const thread = threads.find(item => item.inquiryId === id);
      if (!thread) throw new Error("This client hub is unavailable. Your text has been kept.");
      draft.history = thread.internalNotes || "";
      draft.entries = thread.internalNoteEntries;
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
