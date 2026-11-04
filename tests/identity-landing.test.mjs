import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const script = readFileSync(new URL("../identity-landing.js", import.meta.url), "utf8");
function destination(hash) {
  let next = null;
  runInNewContext(script, { URLSearchParams, window: { location: { hash, replace: value => { next = value; } } } });
  return next;
}
test("email callbacks preserve encoded tokens in a same-origin Admin fragment", () => {
  for (const key of ["recovery_token", "invite_token"]) {
    const hash = `#${key}=sample%2Btoken&redirect_to=https://example.com`;
    assert.equal(destination(hash), "/admin" + hash);
  }
});
test("ordinary homepage anchors and empty callbacks remain on the homepage", () => {
  for (const hash of ["", "#services", "#recovery_token=", "#recovery_token=%20", "#redirect_to=https://example.com"]) assert.equal(destination(hash), null);
});
