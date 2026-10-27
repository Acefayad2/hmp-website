import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeInformationTemplates, informationTemplates } from "../information-form-schema.mjs";
import { informationSummary, informationPreviewHTML, informationIntroductionHTML, informationFieldsHTML } from "../information-form-ui.mjs";
import { fieldsHTML } from "../agreement-ui.mjs";
import { informationClientHeading } from "../information-client.mjs";

test("digital payment instructions appear once before payment fields on new and saved unfinished forms", () => {
  for (const id of ["money-changing-details", "money-collecting-changing-details"]) {
    const template = structuredClone(informationTemplates.find(t => t.id === id));
    template.version = "2026-10-12.1";
    const original = structuredClone(template);
    const values = {paymentPlatformOne:"<script>unsafe</script>",qrCodeInstructions:"Sent via portal"};
    const html = informationFieldsHTML(template.clientFields, values);
    assert.equal((html.match(/aria-label="Digital payment QR-code instructions"/g) || []).length, 1);
    assert.ok(html.indexOf("How to get your Cash App QR code") < html.indexOf('name="paymentPlatformOne"'));
    for (const text of ["How to get your Venmo QR code", "Me tab", "Venmo me", "not Show to pay", "301-471-0990", "screenshot", "login codes"]) assert.ok(html.includes(text), text);
    assert.ok(html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
    assert.ok(html.includes("Sent via portal"));
    assert.doesNotMatch(html, /<script>/);
    assert.deepEqual(template, original);
    const record = {snapshot:template,clientAnswers:values,adminAnswers:{},status:"Sent"};
    assert.match(informationPreviewHTML(record), /How to get your Cash App QR code/);
    assert.doesNotMatch(informationPreviewHTML({...record,status:"Completed"}), /How to get your Cash App QR code/);
  }
  const collecting = activeInformationTemplates.find(t => t.id === "money-collecting-details");
  assert.equal(informationFieldsHTML(collecting.clientFields), fieldsHTML(collecting.clientFields));
  const client = readFileSync(new URL("../information-client.mjs", import.meta.url), "utf8");
  assert.match(client, /informationFieldsHTML\(record\.snapshot\.clientFields/);
});

test("client intake heading omits internal service labels and Prepared for, including saved snapshots", () => {
  for (const template of activeInformationTemplates) {
    const record = {snapshot:structuredClone(template), clientName:"Example Client", adminAnswers:{eventName:"White Wedding"}};
    const original = structuredClone(record);
    assert.equal(informationClientHeading(record), "<p>Example Client · White Wedding</p>");
    assert.deepEqual(record, original);
    record.status = "Completed";
    record.snapshot.version = "2026-10-13.1";
    assert.equal(informationClientHeading(record), "<p>Example Client · White Wedding</p>");
    record.adminAnswers.eventName = "";
    assert.equal(informationClientHeading(record), "<p>Example Client</p>");
    record.clientName = "<img src=x>";
    record.adminAnswers.eventName = "<script>bad()</script>";
    assert.equal(informationClientHeading(record), "<p>&lt;img src=x&gt; · &lt;script&gt;bad()&lt;/script&gt;</p>");
  }
  assert.equal(informationClientHeading({snapshot:{id:"legacy",subtitle:"Legacy details"},clientName:"Client",adminAnswers:{}}), "<p>Legacy details</p><p>Prepared for Client</p>");
});

test("only the two renamed intake forms are offered; retired records remain supported", () => {
  assert.deepEqual(activeInformationTemplates.map(t => [t.id, t.title, t.subtitle]), [
    ["money-collecting-details", "Money Table Intake Form", "For Collecting"],
    ["money-changing-details", "Money Table Intake Form", "For Changing"],
  ]);
  assert.equal(informationTemplates.filter(t => t.retired).length, 4);
  for (const template of activeInformationTemplates) {
    assert.equal(template.description, "");
    assert.doesNotMatch(template.description, /Event Details Form/);
    const summary = informationSummary({snapshot:template, clientName:"Client",clientEmail:"client@example.test",adminAnswers:{},clientAnswers:{}});
    assert.ok(summary.includes(`<h2>Money Table Intake Form</h2><p>${template.subtitle}</p>`));
  }
  const admin = readFileSync(new URL("../src/client-forms.js", import.meta.url), "utf8");
  assert.match(admin, /innerHTML = activeInformationTemplates\.map/);
  assert.match(admin, /rows = data\.agreements\.filter\(row => informationTemplates\.some/);
});

test("full preview uses unsaved wording, escapes content and cannot submit", () => {
  const record = {snapshot:{...activeInformationTemplates[0],description:"Custom greeting\n<script>unsafe</script>"},clientName:"Test Client",clientEmail:"qa@example.test",adminAnswers:{eventName:"Test Event"},clientAnswers:{}};
  const original = structuredClone(record);
  const html = informationPreviewHTML(record);
  assert.match(html, /Test Client · Test Event/);
  assert.match(html, /Custom greeting\n&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(html, /fieldset disabled/);
  for (const field of record.snapshot.clientFields) assert.ok(html.includes(`name="${field.id}"`));
  assert.doesNotMatch(html, /type="submit"|<script>/);
  assert.deepEqual(record, original);
  assert.equal(informationIntroductionHTML({snapshot:{description:""}}), "");
});

test("three original information forms are native templates, separate from contracts and receipts", () => {
  assert.deepEqual(informationTemplates.slice(0,3).map(t => t.sourceUrl), ["https://forms.gle/97eLqmLSMDEJLdGbA", "https://forms.gle/SAA8R6KxTfwtijct5", "https://forms.gle/zcJ5KvacooVQPRBi9"]);
  assert.deepEqual(informationTemplates.slice(0,3).map(t => t.clientFields.length), [7,4,7]);
  assert.equal(informationTemplates.length, 6);
  for (const t of informationTemplates) {
    assert.equal(t.kind, "information");
    assert.equal(new Set(t.clientFields.map(f => f.id)).size, t.clientFields.length);
    assert.equal(t.signingConsent, undefined);
    assert.ok(t.clientFields.length >= 4);
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
