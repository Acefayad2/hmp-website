import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agreementDraftFields, getAgreementTemplate, validateAnswers } from "../agreement-schema.mjs";
import { fieldsHTML, answersHTML } from "../agreement-ui.mjs";

test("Guest Seating packages render as a required dropdown with current offerings", () => {
  const field = getAgreementTemplate("guest-seating").adminFields[0];
  assert.equal(field.type, "select");
  assert.deepEqual(field.options, ["Guest Arrival", "Arrival + Directory"]);
  const html = fieldsHTML([field], {}, "admin-answer");
  assert.match(html, /<select[^>]*name="selectedService" required/);
  assert.match(html, /Choose an option/);
  assert.doesNotMatch(html, /<textarea/);
  for (const selectedService of field.options) {
    assert.equal(validateAnswers([field], {selectedService}).selectedService, selectedService);
    assert.match(fieldsHTML([field], {selectedService}), /<option selected>/);
  }
  assert.throws(() => validateAnswers([field], {}), /Selected service \/ package is required/);
  assert.throws(() => validateAnswers([field], {selectedService:"Invalid"}), /is invalid/);
});

test("old draft values remain selectable without altering stored fields or issued text", () => {
  const snapshot = {...getAgreementTemplate("guest-seating"), adminFields:[{id:"selectedService",label:"Selected service / package",type:"textarea",required:true}]};
  const original = structuredClone(snapshot);
  for (const selectedService of ["", "Guest Arrival", "Custom <VIP> & package", "X".repeat(1000)]) {
    const fields = agreementDraftFields(snapshot, {selectedService});
    assert.equal(fields[0].type,"select");
    if (selectedService) assert.ok(fields[0].options.includes(selectedService));
    const html = fieldsHTML(fields, {selectedService});
    assert.doesNotMatch(html, /<VIP>/);
    if (selectedService) assert.match(html, /<option selected>/);
    assert.equal(validateAnswers(snapshot.adminFields, {selectedService}, false).selectedService, selectedService);
    assert.deepEqual(snapshot, original);
  }
  assert.match(answersHTML(snapshot.adminFields, {selectedService:"Existing signed package"}), /Existing signed package/);
  const other = getAgreementTemplate("welcome-sign");
  assert.equal(agreementDraftFields(other), other.adminFields);
  const source = readFileSync(new URL("../src/agreement-admin.js", import.meta.url),"utf8");
  assert.match(source, /fieldsHTML\(agreementDraftFields\(active.snapshot, active.adminAnswers\)/);
});
