export const clientHubLanguages = [
  ["en", "English", "English"], ["zh-Hans", "Mandarin Chinese", "简体中文"],
  ["hi", "Hindi", "हिन्दी"], ["es", "Spanish", "Español"],
  ["fr", "French", "Français"], ["ar", "Modern Standard Arabic", "العربية الفصحى"],
  ["bn", "Bengali", "বাংলা"], ["pt", "Portuguese", "Português"],
  ["ru", "Russian", "Русский"], ["ur", "Urdu", "اردو"],
  ["id", "Indonesian", "Bahasa Indonesia"], ["de", "German", "Deutsch"],
  ["ja", "Japanese", "日本語"], ["ar-EG", "Egyptian Arabic", "العربية المصرية"],
];

export const clientHubLanguage = (code) => clientHubLanguages.find(([value]) => value === code) || clientHubLanguages[0];

export function collectTranslatableText(roots) {
  const nodes = [];
  for (const root of roots) {
    if (!root) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = node.textContent?.trim();
      if (!value || !node.parentElement || node.parentElement.closest("input, textarea, script, style, .document-print-original, .client-hub-controls")) continue;
      nodes.push(node);
    }
  }
  return nodes;
}

export function translationBatches(nodes, maxItems = 70, maxCharacters = 14000) {
  const batches = [];
  let batch = [], size = 0;
  for (const node of nodes) {
    const length = node.textContent?.length || 0;
    if (length > 2500) continue;
    if (batch.length && (batch.length >= maxItems || size + length > maxCharacters)) {
      batches.push(batch); batch = []; size = 0;
    }
    batch.push(node); size += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
