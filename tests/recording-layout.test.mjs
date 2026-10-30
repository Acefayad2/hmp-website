import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("each inquiry date precedes its own event details and service summary stays last", () => {
  const html = readFileSync(new URL("../inquiry.html", import.meta.url), "utf8");
  const expected = [
    '>First event</h3>', 'name="celebration-date"', 'name="location"',
    'name="start-time"', 'name="end-time"', 'name="vendor-exit-time"',
    'name="service-start-time"', 'name="service-end-time"',
    '>Second event <small>optional</small></h3>', 'name="second-date"',
    'name="second-location"', 'name="second-guest-count"',
    'name="second-start-time"', 'name="second-end-time"',
    'name="second-vendor-exit-time"', 'name="second-service-start-time"',
    'name="second-service-end-time"', '>Service summary</h3>', 'name="total-service-hours"',
  ];
  let previous = -1;
  for (const token of expected) {
    const at = html.indexOf(token);
    assert.ok(at > previous, `${token} should follow the previous event field`);
    previous = at;
    assert.equal(html.indexOf(token, at + token.length), -1, `${token} occurs once`);
  }
});

test("Admin navigation, guidance and both document workspace titles say Agreements", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  assert.equal(html.match(/Invoices &amp; Agreements/g)?.length, 2);
  assert.equal(js.match(/title: "Invoices & Agreements"/g)?.length, 2);
  assert.doesNotMatch(html + js, /Invoices (?:&amp;|&) Contracts/);
  assert.match(html, /href="\/admin\?view=invoices"/);
});

test("Money Bank hides only Admin terms preview, retaining signed and printed terms", () => {
  const admin = readFileSync(new URL("../src/agreement-admin.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../agreement-ui.mjs", import.meta.url), "utf8");
  assert.match(admin, /active\.snapshot\.id !== "money-bank-verification" \? `<details class="agreement-panel"><summary>Review full agreement text/);
  assert.match(ui, /<h2>Agreement terms<\/h2>\$\{termsHTML\(agreement\.snapshot\)\}/);
});
