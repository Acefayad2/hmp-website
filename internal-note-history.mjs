import {validatePageFormatting} from './agreement-formatting.mjs';
const prefix = 'HMP-NOTES-V1\n';
export function readInternalNotes(value = '') {
  const text = String(value || '');
  if (text.startsWith(prefix)) {
    const entries = JSON.parse(text.slice(prefix.length));
    if (!Array.isArray(entries)) throw new Error('Saved notes could not be read.');
    return entries;
  }
  // Preserve undated legacy text and split only the application's dated headers.
  const parts = text.split(/(?:^|\n\n)(?=\[\d{4}-\d{2}-\d{2}T[^\]\n]+ · [^\]\n]+\]\n)/).filter(Boolean);
  return parts.map((part,index) => {
    const match = part.match(/^\[([^\]\n]+) · ([^\]\n]+)\]\n([\s\S]*)$/);
    return {id:`legacy-${index}`, text:match ? match[3] : part, createdAt:match?.[1] || null, author:match?.[2] || '', formatting:[]};
  });
}
export function internalNotesText(value) {
  return readInternalNotes(value).map(note => [note.createdAt ? `[${note.createdAt} · ${note.author}]` : '',note.text].filter(Boolean).join('\n')).join('\n\n');
}
export function changeInternalNotes(value, {action, noteId, text, formatting = [], author, timestamp, id}) {
  const entries = readInternalNotes(value);
  const index = entries.findIndex(note => note.id === noteId);
  if (['edit-note','delete-note'].includes(action) && index < 0) throw new Error('This note is unavailable. Reload saved notes.');
  if (action === 'delete-note') entries.splice(index,1);
  else {
    if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new Error('Enter a note of up to 5,000 characters.');
    const runs = validatePageFormatting(text,formatting);
    if (action === 'edit-note') entries[index] = {...entries[index],text,formatting:runs,updatedAt:timestamp,updatedBy:author};
    else entries.push({id,text,formatting:runs,createdAt:timestamp,author});
  }
  return prefix + JSON.stringify(entries);
}
