import { formattedPageHTML } from "../agreement-formatting.mjs";

// Read only text and the supported marks from the browser editor, never its HTML.
export function readAgreementEditor(editor) {
  let text = "", formatting = [];
  const append = (value, marks) => {
    if (!value) return;
    const start = text.length;
    text += value;
    const run = {start,end:text.length,...marks}, previous = formatting.at(-1);
    if (previous && ["bold","italic","underline","align","list"].every(key => previous[key] === run[key])) previous.end = run.end;
    else formatting.push(run);
  };
  const walk = (node, inherited = {}) => {
    if (node.nodeType === 3) return append(node.textContent,inherited);
    if (node.nodeType !== 1) return;
    if (["SCRIPT","STYLE","IFRAME","OBJECT"].includes(node.tagName)) return;
    if (node.tagName === "BR") return append("\n",inherited);
    const marks = {...inherited};
    if (node.tagName === "LI") marks.list = "bullet";
    if (["B","STRONG"].includes(node.tagName) || ["bold","700"].includes(node.style.fontWeight)) marks.bold = true;
    if (["normal","400"].includes(node.style.fontWeight)) delete marks.bold;
    if (["I","EM"].includes(node.tagName) || node.style.fontStyle === "italic") marks.italic = true;
    if (node.style.fontStyle === "normal") delete marks.italic;
    if (node.tagName === "U" || node.style.textDecoration.includes("underline")) marks.underline = true;
    const align = node.style.textAlign || node.getAttribute("align") || [...node.classList].find(name => name.startsWith("agreement-align-"))?.replace("agreement-align-", "");
    if (["left","center","right"].includes(align)) marks.align = align;
    const children = [...node.childNodes];
    children.forEach((child,i) => {
      // Contenteditable uses div/p containers for lines, including empty ones.
      if (i && (["DIV","P","UL","OL","LI"].includes(child.nodeName) || ["DIV","P","UL","OL","LI"].includes(children[i-1].nodeName))) append("\n",marks);
      if (child.nodeName === "BR" && children.length === 1) return;
      walk(child,marks);
    });
  };
  walk(editor);
  return {text, formatting};
}

export function mountAgreementEditors(root, snapshot, onChange) {
  root.querySelectorAll("[data-agreement-editor]").forEach(editor => {
    const index = Number(editor.dataset.agreementEditor), wrapper = editor.closest(".agreement-text-wrapper");
    editor.innerHTML = formattedPageHTML(snapshot.pages[index],snapshot.pageFormatting?.[index]);
    const toolbar = wrapper.querySelector(".agreement-format-toolbar"), help = wrapper.querySelector(".agreement-format-help");
    let range = null;
    const capture = () => {
      const selection = window.getSelection();
      if (selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) range = selection.getRangeAt(0).cloneRange();
    };
    editor.addEventListener("keyup",capture);
    editor.addEventListener("pointerup",capture);
    editor.addEventListener("input", () => {capture(); onChange();});
    toolbar.addEventListener("pointerdown",event => { if (event.target.closest("button")) {capture(); event.preventDefault();} });
    toolbar.addEventListener("click",event => {
      const button = event.target.closest("[data-format-command]");
      if (!button || editor.getAttribute("contenteditable") !== "true") return;
      const command = button.dataset.formatCommand;
      if (command === "spelling") {help.hidden = !help.hidden; return;}
      editor.focus();
      if (range && editor.contains(range.commonAncestorContainer)) {
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      }
      // A checkbox is inserted before selected wording, never in place of it.
      if (command === "checkbox") window.getSelection()?.collapseToStart();
      if (!document.execCommand(command === "checkbox" ? "insertText" : command,false,command === "checkbox" ? "☐ " : null)) {
        help.hidden = false; help.textContent = "Select text first. If this command is unavailable, try your browser’s Edit menu.";
      }
      capture(); onChange();
    });
    editor.addEventListener("paste",event => {
      event.preventDefault();
      document.execCommand("insertText",false,event.clipboardData.getData("text/plain"));
    });
    editor.addEventListener("drop",event => event.preventDefault());
  });
}

export const agreementEditorHTML = index => `<div class="agreement-field agreement-wide agreement-text-wrapper"><span id="agreement-page-label-${index}">Page ${index+1}</span><div class="agreement-format-toolbar" role="toolbar" aria-label="Page ${index+1} formatting">${[["bold","Bold"],["italic","Italic"],["underline","Underline"],["justifyLeft","Left"],["justifyCenter","Center"],["justifyRight","Right"],["insertUnorderedList","Bullets"],["checkbox","Checkbox"],["undo","Undo"],["redo","Redo"],["spelling","Spelling & grammar"]].map(([command,label]) => `<button type="button" data-format-command="${command}"${command === "checkbox" ? ' title="Insert a printable checkbox symbol (not a required client field)"' : ""}>${label}</button>`).join("")}</div><p class="agreement-format-help" hidden>Spelling is enabled. Right-click an underlined word for suggestions. Grammar checking depends on your browser and system settings; in Safari, use Edit → Spelling and Grammar. HMP does not send this text to a separate proofreading service.</p><div data-agreement-editor="${index}" class="agreement-rich-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="agreement-page-label-${index}" spellcheck="true" lang="en"></div></div>`;
