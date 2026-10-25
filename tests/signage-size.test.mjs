import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicCopy = [
  "guest-seating.html",
  "inquiry.html",
  "celebration-accessories.html",
  "index.html",
  "service-option.js",
].map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")).join("\n");

test("public service copy advertises only 32-inch signage", () => {
  assert.match(publicCopy, /(?:^|[^0-9])32(?:”|\"|-inch)/i);
  assert.doesNotMatch(publicCopy, /(?:^|[^0-9])27(?:”|\"|-inch)/i);
});
