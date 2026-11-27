import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("seating packages show all four approved services with their exact pricing and copy", () => {
  const html = read("guest-seating.html");
  const cards = [...html.matchAll(/<a\s+class="price-card"[\s\S]*?<\/a>/g)].map(match => match[0]);
  assert.equal(cards.length, 4);
  assert.match(cards[0], /Guest Arrival[\s\S]*Starting price \$800/);
  assert.match(cards[1], /Guest Registration[\s\S]*Simplify on-site registration with an experience that blends[\s\S]*Starting price \$800/);
  assert.match(cards[2], /Guest Arrival\+Directory[\s\S]*Starting price \$1,450/);
  assert.match(cards[3], /Guest Arrival\+Registration\+Directory[\s\S]*register on-site,[\s\S]*interactive floor plan highlighting their assigned table and[\s\S]*seat—all while[\s\S]*Starting price \$1,950/);
  assert.match(html, /Four ways to welcome/);
  assert.doesNotMatch(html, /Guest Directory|\$1,750/);
});

test("inquiries, agreements and detail pages include all four seating packages", () => {
  assert.match(read("script.js"), /options: \["Guest Arrival", "Guest Registration", "Guest Arrival\+Directory", "Guest Arrival\+Registration\+Directory"\]/);
  assert.doesNotMatch(read("script.js"), /"Guest Directory"/);
  assert.match(read("service-option.js"), /"arrival-directory": \{[\s\S]*?price: "\$1,450"/);
  assert.match(read("service-option.js"), /"guest-registration": \{[\s\S]*?price: "\$800"/);
  assert.match(read("service-option.js"), /"arrival-registration-directory": \{[\s\S]*?price: "\$1,950"/);
  assert.match(read("sitemap.xml"), /guest-registration[\s\S]*arrival-registration-directory/);
  assert.match(read("pages.css"), /\.price-grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(read("brand.css"), /\.price-card h3 \{[\s\S]*?overflow-wrap: anywhere/);
  assert.doesNotMatch(read("service-option.js"), /"guest-directory": \{|\$1,750/);
  assert.doesNotMatch(read("sitemap.xml"), /guest-directory/);
  assert.match(read("service-option.js"), /offeringKey === "guest-directory" \? "\/guest-seating"/);
});
