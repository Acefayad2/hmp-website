import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("current public signage copy offers only 32-inch displays", () => {
  for (const file of ["index.html", "inquiry.html", "guest-seating.html"]) {
    assert.match(read(file), /32” Premium LED Signage/, file);
  }
  assert.match(read("celebration-accessories.html"), /digital welcome display available in a 32” size/);
  assert.match(read("service-option.js"), /a 32-inch format/);
  assert.match(read("service-option.js"), /Available in a 32-inch size/);
  assert.doesNotMatch(read("service-option.js"), /size that best fits the venue/);
  assert.match(read("service-option.js"), /Customized 32-inch Premium LED Signage/);
  // Scope to current published source copy, not historical design notes or records.
  for (const file of readdirSync(new URL("../", import.meta.url)).filter(name => /\.(?:html|js|mjs)$/.test(name))) {
    assert.doesNotMatch(read(file), /\b27\s*(?:[”″"]|&(?:quot|rdquo|Prime);|[-–]?\s*inch)/i, file);
  }
});
