import {normalizeTextFormatting,richTextHTML} from "./text-formatting.mjs";
import {appendLinkedText} from "./calendar-link.js";
export function normalizeMessageFormatting(raw, text, runs) {
  if (runs === undefined) return [];
  return normalizeTextFormatting({body:raw,textFormatting:{body:runs}},{body:text},["body"]).textFormatting?.body || [];
}
export function renderMessageText(element, text, runs) {
  if (!runs?.length) return appendLinkedText(element,text);
  element.innerHTML=richTextHTML(text,runs).replace(/ style="[^"]*"/g, "");
  // Linkify only escaped text nodes; stored markup is never trusted.
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT), nodes=[];
  while(walker.nextNode()) nodes.push(walker.currentNode);
  for(const node of nodes) {
    const fragment=document.createDocumentFragment();
    appendLinkedText(fragment,node.textContent);
    node.replaceWith(fragment);
  }
  return element;
}
