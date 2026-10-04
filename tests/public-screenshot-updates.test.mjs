import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const normalize = (text) => text.replace(/\s+/g, " ").trim();

test("seating package descriptions match the approved screenshot copy", () => {
  const html = read("guest-seating.html");
  const descriptions = [...html.matchAll(/<a\s+class="price-card"[\s\S]*?<p>([\s\S]*?)<\/p>/g)]
    .map((match) => normalize(match[1]));

  assert.deepEqual(descriptions, [
    "From arrival to seating, our interactive check-in experience guides guests and attendees with ease. They can quickly find their name, confirm their arrival, and display their assigned table number—all within a seamless, sophisticated experience designed to elevate the guest journey.",
    "Designed to make guest arrival effortless. This interactive experience allows guests to quickly find their name, confirm their arrival, and view the event’s floorplan which highlights their exact assigned table and seat —all while creating a seamless, organized, and elevated event experience.",
  ]);
  assert.match(html, /Starting price \$800/);
  assert.match(html, /Starting price \$1,450/);
});

test("public footers omit admin login and the build does not reinsert it", () => {
  const pages = ["index.html", "about.html", "services.html", "guest-seating.html", "celebration-accessories.html", "money-table.html", "inquiry.html", "service-option.html", "privacy.html", "404.html"];
  let footerCount = 0;
  for (const page of pages) {
    const footers = read(page).match(/<footer\b[\s\S]*?<\/footer>/g) || [];
    for (const footer of footers) {
      footerCount += 1;
      assert.doesNotMatch(footer, /Admin login|href=["']\/admin(?:["'/?#]|$)/i, page);
    }
  }
  assert.equal(footerCount, 10);
  assert.doesNotMatch(read("scripts/build-admin.mjs"), /Admin login|withAdminAccess/);
});

test("admin and dashboard routes remain packaged with their existing entry points", () => {
  const build = read("scripts/build-admin.mjs");
  assert.match(build, /copyFile\("admin\.html",/);
  assert.match(build, /entryPoints: \["src\/admin\.js"\]/);
  assert.match(build, /"dashboard\.html"/);
  assert.match(read("dashboard.html"), /href="\/admin"/);
});
