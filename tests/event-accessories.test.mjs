import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("Money Guns appear only in the Club Sign bundle, not as a separate accessory", () => {
  const accessories = read("celebration-accessories.html");
  assert.equal((accessories.match(/class="price-card"/g) || []).length, 3);
  assert.match(accessories, /<h3>Club Sign \+ Money Guns \+ Strobes<\/h3>[\s\S]*?<strong>Starting rental price \$170<\/strong>/);
  assert.match(accessories, /service-option=Club%20Sign%20%2B%20Money%20Guns%20%2B%20Strobes/);
  assert.match(read("service-option.js"), /title: "Club Sign \+ Money Guns \+ Strobes"[\s\S]*?price: "\$170"/);
  assert.match(read("script.js"), /"Club Sign \+ Money Guns \+ Strobes"/);
  assert.doesNotMatch(accessories, /<h3>Money Guns<\/h3>/);
});

test("old Money Guns links lead back to Event Accessories", () => {
  const redirects = read("netlify.toml");
  assert.match(redirects, /from = "\/services\/celebration-accessories\/money-guns"\s+to = "\/celebration-accessories"\s+status = 301/);
  assert.ok(redirects.indexOf("/services/celebration-accessories/money-guns") < redirects.indexOf("/services/:category/:offering"));
});

test("Event Accessories summaries use the lowest current catalog price", () => {
  const catalog = read("service-option.js");
  const prices = [...catalog.matchAll(/category: "Event Accessories"[\s\S]*?price: "\$(\d[\d,]*)"/g)]
    .map(([, price]) => Number(price.replaceAll(",", "")));
  const startingPrice = Math.min(...prices);

  assert.deepEqual(prices.sort((a, b) => a - b), [100, 170, 250]);
  assert.match(read("index.html"), new RegExp(`01 · Event Accessories[\\s\\S]*?Starting at <strong>\\$${startingPrice}<\\/strong>`));
  assert.match(read("services.html"), new RegExp(`<h2>Event Accessories<\\/h2>[\\s\\S]*?<span>Starting at \\$${startingPrice}<\\/span>`));
});
