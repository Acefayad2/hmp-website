import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../src/client-forms.js", import.meta.url), "utf8");

test("Forms contains the working original and two replacement links; agreements and receipts remain available", () => {
  const forms = html.slice(html.indexOf('id="forms-workspace"'), html.indexOf('id="contract-workspace"'));
  for (const id of ["97eLqmLSMDEJLdGbA", "SAA8R6KxTfwtijct5", "zcJ5KvacooVQPRBi9"]) {
    assert.ok(forms.includes(`href="https://forms.gle/${id}" target="_blank" rel="noopener noreferrer"`));
    assert.ok(forms.includes(`readonly value="https://forms.gle/${id}"`));
  }
  assert.doesNotMatch(html, /TfkYSSEPaC7n65LS8|kcBYS5NyjhZjnMnVA|Google sign-in required/);
  assert.match(forms, /id="create-receipt"/);
  assert.match(html.slice(html.indexOf('id="contract-workspace"')), /id="agreement-template-list"/);
  assert.match(html.slice(html.indexOf('id="contract-workspace"')), /id="agreement-list"/);
  const admin = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  assert.match(admin, /if \(isContracts\) loadAgreementForms\(\)/);
});

for (const blocked of [false, true]) {
  test(`copy form link ${blocked ? "provides a manual fallback" : "copies the selected card only"}`, async () => {
    let click, copied, focused = false, selected = false;
    const input = { value: "https://forms.gle/SAA8R6KxTfwtijct5", focus() { focused = true; }, select() { selected = true; } };
    const status = { textContent: "" };
    const card = { querySelector: selector => selector === ".client-form-link" ? input : status };
    runInNewContext(script, {
      document: { querySelector: () => ({ addEventListener: (_, callback) => { click = callback; } }) },
      navigator: { clipboard: { async writeText(value) { if (blocked) throw new Error("Denied"); copied = value; } } },
    });
    await click({ target: { closest: () => ({ closest: () => card }) } });
    if (blocked) {
      assert.ok(focused && selected);
      assert.match(status.textContent, /copy it manually/);
    } else {
      assert.equal(copied, input.value);
      assert.match(status.textContent, /Link copied/);
    }
  });
}
