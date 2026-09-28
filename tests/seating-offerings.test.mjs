import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("seating packages show Guest Arrival first and Arrival + Directory at $1,450", () => {
  const html = read("guest-seating.html");
  const cards = [...html.matchAll(/<a\s+class="price-card"[\s\S]*?<\/a>/g)].map(match => match[0]);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /Guest Arrival[\s\S]*Starting price \$800/);
  assert.match(cards[1], /Arrival \+ Directory[\s\S]*Starting price \$1,450/);
  assert.match(html, /Two ways to welcome/);
  assert.doesNotMatch(html, /Guest Directory|\$1,750/);
});

test("inquiries and detail pages match the two currently offered seating packages", () => {
  assert.match(read("script.js"), /options: \["Guest Arrival", "Arrival \+ Directory"\]/);
  assert.doesNotMatch(read("script.js"), /"Guest Directory"/);
  assert.match(read("service-option.js"), /"arrival-directory": \{[\s\S]*?price: "\$1,450"/);
  assert.doesNotMatch(read("service-option.js"), /"guest-directory": \{|\$1,750/);
  assert.doesNotMatch(read("sitemap.xml"), /guest-directory/);
  assert.match(read("service-option.js"), /offeringKey === "guest-directory" \? "\/guest-seating"/);
});
