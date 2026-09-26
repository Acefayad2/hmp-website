import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
// The user explicitly restored this product name; generic copy still uses event.
const withoutProductName = (text) => text.replace(/\bCelebration Kits?\b/g, "Kit");

test("website copy, accessible labels and metadata use event wording", () => {
  for (const file of readdirSync(root).filter((file) => file.endsWith(".html"))) {
    const html = read(file);
    const prose = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ");
    assert.doesNotMatch(withoutProductName(prose), /\b(celebrations?|occasions?)\b/i, file);
    for (const [, value] of html.matchAll(/(?:alt|aria-label|placeholder|content)="([^"]*)"/g)) {
      if (!value.startsWith("https://")) assert.doesNotMatch(withoutProductName(value), /\b(celebrations?|occasions?)\b/i, file);
    }
  }
});

test("old service labels remain compatible without changing client-written content", () => {
  for (const file of ["script.js", "src/admin.js", "conversation.js"]) {
    const declaration = read(file).split("\n").find((line) => line.startsWith("const eventServiceLabel ="));
    const label = runInNewContext(`${declaration}\neventServiceLabel`);
    assert.equal(label("Celebration Accessories"), "Event Accessories");
    assert.equal(label("Celebration Kit"), "Celebration Kit");
    assert.equal(label("Event Kit"), "Celebration Kit");
    assert.equal(label("Guest Seating Experience, Celebration Accessories"), "Guest Seating Experience, Event Accessories");
    assert.equal(label("Our celebration was lovely"), "Our celebration was lovely");
    assert.equal(label(null), "");
  }
  const script = read("script.js");
  assert.ok(script.includes('eventServiceLabel(inquiryParams.get("service"))'));
  assert.ok(script.includes('eventServiceLabel(inquiryParams.get("service-option"))'));
  assert.ok(read("inquiry.html").includes("<option>Event Accessories</option>"));
  assert.ok(read("celebration-accessories.html").includes("service=Event%20Accessories&amp;service-option=Celebration%20Kit"));
  assert.ok(read("celebration-accessories.html").includes("<h3>Celebration Kit</h3>"));
  assert.ok(read("service-option.js").includes('title: "Celebration Kit"'));
  assert.ok(script.includes('"Celebration Kit",'));
});
