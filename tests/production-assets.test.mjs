import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("every local homepage image, script and stylesheet is packaged for production", () => {
  const source = readFileSync(new URL("../scripts/build-admin.mjs", import.meta.url), "utf8");
  const manifest = runInNewContext(source.match(/const productionFiles = \[[\s\S]*?\];/)[0] + "\nproductionFiles");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const tags = html.match(/<(?:img|script)\b[^>]*>|<link\b[^>]*rel="stylesheet"[^>]*>/g) || [];
  for (const tag of tags) {
    const url = tag.match(/(?:src|href)="([^"]+)"/)?.[1];
    if (!url || /^(?:https?:)?\/\//.test(url)) continue;
    const path = url.split("?")[0].replace(/^\//, "");
    assert.ok(manifest.includes(path), `${path} missing from production manifest`);
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${path} missing from repository`);
  }
});
