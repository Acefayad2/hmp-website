import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("Money Guns are no longer offered or advertised", () => {
  const accessories = read("celebration-accessories.html");
  assert.equal((accessories.match(/class="price-card"/g) || []).length, 3);
  for (const file of ["celebration-accessories.html", "service-option.js", "script.js", "seo-schema.js", "sitemap.xml"]) {
    assert.doesNotMatch(read(file), /money[ -]?guns?/i, file);
  }
});

test("old Money Guns links lead back to Event Accessories", () => {
  const redirects = read("netlify.toml");
  assert.match(redirects, /from = "\/services\/celebration-accessories\/money-guns"\s+to = "\/celebration-accessories"\s+status = 301/);
  assert.ok(redirects.indexOf("/services/celebration-accessories/money-guns") < redirects.indexOf("/services/:category/:offering"));
});
