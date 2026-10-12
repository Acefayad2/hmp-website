import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

test("Netlify deploys only built function entrypoints", () => {
  execFileSync(process.execPath, ["scripts/build-functions.mjs"], { stdio: "pipe" });

  const sourceEntries = readdirSync(new URL("../netlify/functions", import.meta.url))
    .filter((file) => file.endsWith(".mts") && !file.startsWith("_"))
    .map((file) => file.replace(/\.mts$/, ".mjs"))
    .sort();
  const builtEntries = readdirSync(new URL("../.netlify/deploy-functions", import.meta.url))
    .filter((file) => file.endsWith(".mjs"))
    .sort();

  assert.deepEqual(builtEntries, sourceEntries);
  assert.equal(builtEntries.some((file) => file.startsWith("_")), false);

  const config = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\]\s+directory = "\.netlify\/deploy-functions"/);
  assert.match(config, /command = "npm run build && npm run build:functions"/);
});
