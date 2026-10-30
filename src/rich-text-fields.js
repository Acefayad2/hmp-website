import {agreementEditorHTML, mountAgreementEditors, readAgreementEditor} from "./agreement-text-editor.js";
import {richTextHTML} from "../text-formatting.mjs";

const editors = new WeakMap();
let sequence = 0;
export function setRichField(field, runs = []) {
  if (!field || field.tagName !== "TEXTAREA") return;
  let state = editors.get(field);
  if (!state) {
    const host = document.createElement("div");
    host.className = "rich-field-host";
    host.innerHTML = agreementEditorHTML(0);
    const editor = host.querySelector("[data-agreement-editor]"), label = host.querySelector("span");
    label.id = `rich-field-label-${++sequence}`;
    label.textContent = field.getAttribute("aria-label") || field.labels?.[0]?.querySelector("span")?.textContent || field.labels?.[0]?.childNodes[0]?.textContent?.trim() || field.name || "Text formatting";
    label.className = "rich-field-label";
    editor.setAttribute("aria-labelledby",label.id);
    host.querySelector("[role=toolbar]").setAttribute("aria-label",`${label.textContent} formatting`);
    field.after(host);
    field.classList.add("rich-field-source");
    field.setAttribute("aria-hidden","true");
    field.tabIndex = -1;
    state = {editor, host, runs:[], syncing:false};
    editors.set(field,state);
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value");
    Object.defineProperty(field,"value",{
      configurable:true,
      get(){return nativeValue.get.call(this);},
      set(value){nativeValue.set.call(this,value); if (!state.syncing) {state.runs=[]; editor.innerHTML=richTextHTML(this.value); this.setCustomValidity("");}},
    });
    mountAgreementEditors(host,{pages:[field.value]},() => {
      const value = readAgreementEditor(editor);
      state.syncing = true; field.value = value.text; state.syncing = false;
      state.runs = value.formatting;
      field.setCustomValidity(field.maxLength >= 0 && value.text.length > field.maxLength ? `Shorten this text to ${field.maxLength} characters (${value.text.length} entered).` : "");
      field.dispatchEvent(new Event("input",{bubbles:true}));
      field.dispatchEvent(new Event("change",{bubbles:true}));
    });
    editor.removeAttribute("data-agreement-editor");
    editor.dataset.richField = field.id || field.name || "text";
    const syncDisabled = () => {
      const locked = field.disabled || field.readOnly;
      editor.setAttribute("contenteditable",String(!locked));
      editor.setAttribute("aria-disabled",String(locked));
      host.querySelectorAll("button").forEach(button => button.disabled=locked);
    };
    new MutationObserver(syncDisabled).observe(field,{attributes:true,attributeFilter:["disabled","readonly"]});
    syncDisabled();
    field.addEventListener("focus",() => editor.focus());
    field.form?.addEventListener("reset",() => queueMicrotask(() => setRichField(field)));
  }
  state.runs = runs;
  state.editor.innerHTML = richTextHTML(field.value,runs);
}
export function richFieldFormatting(field) { return editors.get(field)?.runs || []; }
export function mountRichFields(mapping, formatting = {}, root = document) {
  for (const [key,selector] of Object.entries(mapping)) setRichField(root.querySelector(selector),formatting[key] || []);
}
export function collectRichFields(mapping, root = document) {
  return {textFormatting:Object.fromEntries(Object.entries(mapping).filter(([,selector]) => root.querySelector(selector)?.tagName === "TEXTAREA").map(([key,selector]) => [key,richFieldFormatting(root.querySelector(selector))]))};
}
