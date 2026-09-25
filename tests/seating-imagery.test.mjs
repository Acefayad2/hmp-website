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

test("seating starting prices state both guest-count and distance conditions before the packages", () => {
  const html = read("guest-seating.html").replace(/\s+/g, " ");
  assert.match(html, /Starting prices shown apply to events with up to 230 guests at venues within 30 miles of Laurel, MD\./);
  assert.ok(html.indexOf('class="seating-price-note"') < html.indexOf('class="price-grid"'));
  assert.match(html, /Starting price \$1,750/);
  assert.equal((html.match(/Starting price \$800/g) || []).length, 2);
});
