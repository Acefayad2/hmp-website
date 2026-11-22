import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("Event Accessories is removed from public and inquiry surfaces", () => {
  for (const file of ["index.html", "services.html", "inquiry.html", "admin.html", "service-option.js", "review-request-schema.mjs", "seo-schema.js", "sitemap.xml"]) {
    assert.doesNotMatch(read(file), /Event Accessories|event accessories|celebration-accessories/i, file);
  }
  assert.doesNotMatch(read("scripts/build-admin.mjs"), /celebration-accessories/i);
});

test("legacy Event Accessories URLs redirect to the active services directory", () => {
  const redirects = read("netlify.toml");
  assert.match(redirects, /from = "\/celebration-accessories"\s+to = "\/services"\s+status = 301/);
  assert.match(redirects, /from = "\/celebration-accessories\.html"\s+to = "\/services"\s+status = 301/);
  assert.match(redirects, /from = "\/services\/celebration-accessories\/\*"\s+to = "\/services"\s+status = 301/);
  assert.ok(redirects.indexOf('/services/celebration-accessories/*') < redirects.indexOf('/services/:category/:offering'));
});

test("Our Moments precedes Inquire in every public navigation", () => {
  for (const file of ["index.html", "about.html", "services.html", "guest-seating.html", "money-table.html", "inquiry.html", "service-option.html", "privacy.html", "404.html", "blog.html"]) {
    const nav = read(file).match(/<nav\b[^>]*aria-label="Main navigation"[^>]*>[\s\S]*?<\/nav>/)?.[0] || "";
    assert.ok(nav.includes("Our Moments"), `${file} must link to Our Moments`);
    assert.ok(nav.includes("Inquire"), `${file} must link to Inquire`);
    assert.ok(nav.indexOf("Our Moments") < nav.indexOf("Inquire"), `${file} must put Our Moments before Inquire`);
  }
});
