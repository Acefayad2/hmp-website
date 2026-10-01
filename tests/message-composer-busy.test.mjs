import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function composer(admin, failure) {
  const source = readFileSync(new URL(admin ? "../src/admin.js" : "../conversation.js", import.meta.url), "utf8");
  const handler = admin
    ? source.slice(source.indexOf("const sendAdminMessage ="), source.indexOf("const deleteActiveConversation =")) + "\nsendAdminMessage"
    : "async (event) => {" + source.split('$("#message-form").addEventListener("submit", async (event) => {')[1].split('\n});')[0] + "\n}";
  const input = { value: "My draft", readOnly: false }, attachments = { disabled: false }, button = { disabled: false }, status = {};
  let release;
  const upload = new Promise(resolve => { release = resolve; });
  const context = {
    activeThreadId: "thread", token: "sample", globalThis: { crypto: { randomUUID: () => "request-id" } },
    $: selector => selector.endsWith("message-input") ? input : selector.endsWith("message-attachments") ? attachments : status,
    selectedFiles: () => [], setAttachmentBusy: (el, previews, value) => { el.disabled = value; },
    setMessage: (el, message) => { el.textContent = message; }, uploadAttachments: () => upload,
    fetch: async () => ({ ok: !failure, json: async () => ({ error: "Send failed" }) }),
    pinRequired: () => false, clearStagedAttachments() {}, updateAttachmentSummary() {}, renderAttachmentPreviews() {},
    loadMessages: async () => {}, loadConversation: async () => {}, showMessageNotificationStatus() {},
  };
  return { input, attachments, button, release, send: () => runInNewContext(handler, context)({ preventDefault() {}, currentTarget: { querySelector: () => button } }) };
}

for (const admin of [true, false]) {
  for (const failure of [true, false]) {
    test(`${admin ? "Admin" : "client"} composer locks the sending draft and restores editing after ${failure ? "failure" : "success"}`, async () => {
      const f = composer(admin, failure);
      const sent = f.send();
      assert.equal(f.input.readOnly, true);
      assert.equal(f.attachments.disabled, true);
      assert.equal(f.button.disabled, true);
      f.release([]);
      await sent;
      assert.equal(f.input.readOnly, false);
      assert.equal(f.attachments.disabled, false);
      assert.equal(f.button.disabled, false);
      assert.equal(f.input.value, failure ? "My draft" : "");
    });
  }
}

test("information forms lock dropdowns along with text fields while saving", () => {
  const source = readFileSync(new URL("../information-client.mjs", import.meta.url), "utf8");
  assert.equal(source.match(/querySelectorAll\("input,textarea,select,button"\)/g)?.length, 2);
});
