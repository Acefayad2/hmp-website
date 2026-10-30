// Formatting is data, never stored HTML. Legacy agreement text remains plain text.
const escape = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]);
const alignments = ["left", "center", "right"];
export function validatePageFormatting(text, formatting = []) {
  if (!Array.isArray(formatting) || formatting.length > 2000) throw new Error("Too much agreement formatting. Simplify this page and try again.");
  let end = 0;
  return formatting.map(run => {
    if (!run || !Number.isInteger(run.start) || !Number.isInteger(run.end) || run.start < end || run.end <= run.start || run.end > text.length) throw new Error("Agreement formatting no longer matches the text. Reopen this draft and try again.");
    end = run.end;
    return {start:run.start, end:run.end, ...(run.bold === true ? {bold:true} : {}), ...(run.italic === true ? {italic:true} : {}), ...(run.underline === true ? {underline:true} : {}), ...(alignments.includes(run.align) ? {align:run.align} : {}), ...(["bullet","number"].includes(run.list) ? {list:run.list} : {})};
  });
}
export function formattedPageHTML(text, formatting = []) {
  const runs = validatePageFormatting(text, formatting);
  let offset = 0, inList = "";
  const result = text.split("\n").map(line => {
    const start = offset, end = start + line.length;
    offset = end + 1;
    const alignment = runs.find(run => run.start <= end && run.end > start && run.align)?.align || "left";
    const boundaries = [...new Set([start, end, ...runs.flatMap(run => [run.start, run.end]).filter(n => n > start && n < end)])].sort((a,b) => a-b);
    const html = boundaries.slice(0,-1).map((from,i) => {
      const to = boundaries[i+1], run = runs.find(r => r.start <= from && r.end >= to);
      let part = escape(text.slice(from,to));
      if (run?.underline) part = `<u>${part}</u>`;
      if (run?.italic) part = `<em>${part}</em>`;
      if (run?.bold) part = `<strong>${part}</strong>`;
      return part;
    }).join("");
    const list = runs.find(run => run.start <= start && run.end > start && run.list)?.list;
    const listTag = list === "number" ? "ol" : list === "bullet" ? "ul" : "";
    const boundary = inList === listTag ? "" : `${inList ? `</${inList}>` : ""}${listTag ? `<${listTag} class="agreement-bullet-list">` : ""}`;
    inList = listTag;
    const tag = listTag ? "li" : "div";
    return `${boundary}<${tag} class="agreement-align-${alignment}">${html || "<br>"}</${tag}>`;
  }).join("");
  return result + (inList ? `</${inList}>` : "");
}
// Replace placeholders while moving formatting ranges with the text they describe.
export function replaceFormattedPage(text, formatting, replace) {
  const runs = validatePageFormatting(text, formatting);
  const matches = [...text.matchAll(/\{\{([A-Za-z]+)\}\}/g)].map(match => ({start:match.index, end:match.index+match[0].length, value:replace(match[1])}));
  const position = (index, ending) => {
    let delta = 0;
    for (const match of matches) {
      if (index <= match.start) break;
      if (index < match.end) return match.start + delta + (ending ? match.value.length : 0);
      delta += match.value.length - (match.end-match.start);
    }
    return index+delta;
  };
  const updated = [];
  for (const run of runs) {
    const start = Math.max(updated.at(-1)?.end || 0, position(run.start,false)), end = position(run.end,true);
    if (end > start) updated.push({...run,start,end});
  }
  let index = 0;
  const value = text.replace(/\{\{([A-Za-z]+)\}\}/g, () => matches[index++].value);
  return {text:value, formatting:validatePageFormatting(value,updated)};
}
