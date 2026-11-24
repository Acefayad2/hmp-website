import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("client documents use plain For labels without prepared headings", async () => {
  const files = [
    "proposal-ui.js",
    "agreement-ui.mjs",
    "agreement-client.mjs",
    "information-client.mjs",
    "document-message-ui.js",
    "src/agreement-admin.js",
    "netlify/functions/hmp-send-contract.mts",
    "netlify/functions/hmp-send-invoice.mts",
  ];
  const sources = await Promise.all(files.map(path =>
    readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  for (const source of sources) assert.doesNotMatch(source, /Prepared for|Prepared service proposal/);
  assert.match(sources[0], /eyebrow\.textContent = "Service proposal"/);
  assert.match(sources[0], /`For \$\{value\.clientName/);
});
