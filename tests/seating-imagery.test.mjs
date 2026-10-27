import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("guest seating uses the supplied desk and kiosk images in the requested placements", () => {
  assert.match(read("index.html"), /class="service-feature-media service-seating-media"[\s\S]*?src="assets\/guest-check-in-desk.webp"/);
  assert.match(read("guest-seating.html"), /class="page-hero-media seating-hero-media"[\s\S]*?src="assets\/guest-check-in-kiosks.webp"/);
  assert.ok(!read("guest-seating.html").includes("hmp-hero-welcome.webp"));
  assert.match(read("brand.css"), /\.guest-seating-page \.seating-hero-media \{[^}]*min-height: 0;[^}]*transform: none;[^}]*animation: none;/);
  assert.match(read("brand.css"), /\.guest-seating-page \.seating-hero-media img \{[^}]*height: auto;[^}]*object-fit: contain;/);
  assert.match(read("brand.css"), /\.service-feature-media\.service-seating-media img \{[^}]*height: auto;[^}]*object-fit: contain;/);
});

test("seating packages omit the retired guest-count and distance qualification", () => {
  const html = read("guest-seating.html").replace(/\s+/g, " ");
  assert.doesNotMatch(html, /up to 230 guests|within 30 miles of Laurel/);
  assert.doesNotMatch(html, /class="seating-price-note"/);
  assert.doesNotMatch(read("brand.css"), /\.guest-seating-page \.seating-price-note/);
  assert.match(html, /Starting price \$1,450/);
  assert.equal((html.match(/Starting price \$800/g) || []).length, 1);
});
