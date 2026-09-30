import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { informationTemplates } from "../information-form-schema.mjs";
import { informationSummary } from "../information-form-ui.mjs";
import { fieldsHTML } from "../agreement-ui.mjs";

test("three original information forms are native templates, separate from contracts and receipts", () => {
  assert.deepEqual(informationTemplates.map(t => t.sourceUrl), ["https://forms.gle/97eLqmLSMDEJLdGbA", "https://forms.gle/SAA8R6KxTfwtijct5", "https://forms.gle/zcJ5KvacooVQPRBi9"]);
  assert.deepEqual(informationTemplates.map(t => t.clientFields.length), [7,4,7]);
  for (const t of informationTemplates) {
    assert.equal(t.kind, "information");
    assert.equal(new Set(t.clientFields.map(f => f.id)).size, t.clientFields.length);
    assert.equal(t.signingConsent, undefined);
    assert.ok(t.clientFields.some(f => f.id === "fundRelease"));
  }
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const forms = html.slice(html.indexOf('id="forms-workspace"'), html.indexOf('id="contract-workspace"'));
  assert.match(forms, /id="information-list"/);
  assert.match(forms, /id="create-receipt"/);
  assert.doesNotMatch(forms, /href="https:\/\/forms.gle/);
  assert.match(html, /id="agreement-template-list"/);
});

test("native fields escape help and answers, show optional details and preserve multiline responses", () => {
  const template = informationTemplates[0];
  const html = fieldsHTML(template.clientFields, {responsibleContact:"<script>bad()</script>"});
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /textarea[^>]+name="responsibleContact"[^>]+required/);
  assert.match(html, /textarea[^>]+name="additionalInformation"\s+rows/);
  assert.match(html, /Never provide passwords/);
  const rendered = informationSummary({snapshot:template,clientName:"<img src=x>",clientEmail:"client@example.test",adminAnswers:{eventName:"Test event"},clientAnswers:{responsibleContact:"First line\nSecond line"},status:"Completed",completedAt:"2026-09-30T12:00:00Z"});
  assert.doesNotMatch(rendered, /<img/);
  assert.match(rendered, /First line\nSecond line/);
  assert.match(rendered, /Test event/);
});
