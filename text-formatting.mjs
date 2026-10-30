import {validatePageFormatting, formattedPageHTML} from "./agreement-formatting.mjs";

// Keep existing plain-text fields readable to older clients. Only allowlisted
// formatting ranges travel alongside them; never accept stored HTML or CSS.
export function normalizeTextFormatting(source, normalized, keys) {
  const metadata = source?.textFormatting;
  if (metadata === undefined) return {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Invalid text formatting.");
  const result = {};
  for (const key of keys) {
    if (metadata[key] === undefined) continue;
    const raw = String(source[key] ?? ""), text = String(normalized[key] ?? "");
    const runs = validatePageFormatting(raw, metadata[key]);
    // Existing field normalization trims and limits text. Move ranges with it.
    const offset = text ? raw.indexOf(text) : 0;
    if (offset < 0) throw new Error(`Formatting no longer matches ${key}. Reopen the draft.`);
    const clipped = runs.map(run => ({...run,start:Math.max(0,run.start-offset),end:Math.min(text.length,run.end-offset)})).filter(run => run.end > run.start);
    const marked = clipped.filter(run => run.bold || run.italic || run.underline || run.list || (run.align && run.align !== "left"));
    if (marked.length) result[key] = marked;
  }
  if (JSON.stringify(result).length > 40000) throw new Error("Too much text formatting. Simplify the formatting and try again.");
  return Object.keys(result).length ? {textFormatting:result} : {};
}
export function richTextHTML(text, runs) {
  const value = String(text ?? "");
  try { return formattedPageHTML(value,runs || []).replace(/class="agreement-align-(left|center|right)"/g,'class="agreement-align-$1" style="text-align:$1"'); }
  catch { return formattedPageHTML(value); } // Corrupt legacy metadata must not hide a document.
}
