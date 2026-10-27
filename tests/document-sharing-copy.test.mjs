import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {beginDeferredClipboardCopy, copySharedLink, createInteractionGuard} from "../src/document-sharing.js";

const clientFormsSource = readFileSync(new URL("../src/client-forms.js", import.meta.url), "utf8");

class FakeBlob {
  constructor(parts, options) { this.parts = parts; this.type = options.type; }
}
class FakeClipboardItem {
  constructor(data) { this.data = data; }
}

test("Safari-compatible copy starts during the click and resolves with the later private link", async () => {
  let writes = 0, copied = "";
  const clipboard = {write(items) {
    writes += 1;
    copied = Promise.resolve(items[0].data["text/plain"]).then(blob => {
      assert.equal(blob.type, "text/plain");
      return blob.parts.join("");
    });
    return copied.then(() => undefined);
  }};
  const prepared = beginDeferredClipboardCopy({clipboard, ClipboardItemClass:FakeClipboardItem, BlobClass:FakeBlob});
  assert.equal(writes, 1, "clipboard permission is requested synchronously from the click");
  await Promise.resolve();
  assert.equal(await prepared.complete("https://hmpeds.com/form#private-token"), true);
  assert.equal(await copied, "https://hmpeds.com/form#private-token");
});

test("interrupted and repeated copy attempts settle once without leaking a later link", async () => {
  let copied;
  const clipboard = {write(items) {
    copied = Promise.resolve(items[0].data["text/plain"]).then(blob => blob.parts.join(""));
    return copied.then(() => undefined);
  }};
  const prepared = beginDeferredClipboardCopy({clipboard, ClipboardItemClass:FakeClipboardItem, BlobClass:FakeBlob});
  assert.equal(await prepared.cancel(), true);
  assert.equal(await prepared.complete("https://hmpeds.com/form#must-not-copy"), false);
  assert.equal(await prepared.cancel(), false);
  await assert.rejects(copied, /Clipboard copy cancelled/);
});

test("rapid repeat clicks keep one sharing interaction in flight", () => {
  const guard = createInteractionGuard();
  assert.equal(guard.begin(), true);
  assert.equal(guard.begin(), false, "the second click is ignored while its modal is pending");
  guard.end();
  assert.equal(guard.begin(), true, "a later intentional click can start after interruption or completion");
  guard.end();
});

test("copy falls back to a selected private input when clipboard access is blocked", async () => {
  const status = {textContent:"", append(node) { this.input = node; }};
  const documentObject = {createElement() {
    return {setAttribute(name,value) { this[name] = value; }, select() { this.selected = true; }};
  }};
  await copySharedLink("https://hmpeds.com/form#fallback-token", status, {
    clipboard:{writeText:async () => { throw new Error("NotAllowedError"); }},
    documentObject,
  });
  assert.match(status.textContent, /Copy this private link manually/);
  assert.equal(status.input.value, "https://hmpeds.com/form#fallback-token");
  assert.equal(status.input.selected, true);
  assert.equal(status.input["aria-label"], "Private client link");
});

test("Forms reuses a live link and safely settles deferred copy on failure", () => {
  assert.match(clientFormsSource, /copy && link && Date\.parse\(active\.expiresAt\) > Date\.now\(\)[\s\S]*copySharedLink\(link,/);
  assert.match(clientFormsSource, /deferClipboardCopy:copy/);
  assert.match(clientFormsSource, /if \(!link\) \{ await preparedCopy\?\.cancel\(\); return; \}/);
  assert.match(clientFormsSource, /catch\(error\) \{ await preparedCopy\?\.cancel\(\);/);
  assert.match(clientFormsSource, /!sharingInteraction\.begin\(\)/);
  assert.match(clientFormsSource, /finally \{ sharingInteraction\.end\(\); \}/);
  assert.doesNotMatch(clientFormsSource, /Link selected\. Copy it manually\./);
});
