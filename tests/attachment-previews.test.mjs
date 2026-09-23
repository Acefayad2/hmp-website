import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attachmentType, selectedFiles, uploadAttachments } from "../attachment-ui.js";

test("mobile files with missing MIME types use only supported extensions", () => {
  assert.equal(attachmentType({ name: "PHONE.MOV", type: "" }), "video/quicktime");
  assert.equal(attachmentType({ name: "details.PDF", type: "" }), "application/pdf");
  assert.equal(attachmentType({ name: "bad.html", type: "" }), "");
  assert.throws(() => selectedFiles({ files: [{ name: "bad.pdf", type: "text/html", size: 10 }] }), /not supported/);
});

test("attachment limits still block invalid sends", () => {
  const file = { name: "photo.jpg", type: "image/jpeg", size: 10 };
  assert.equal(selectedFiles({ files: [file] }).length, 1);
  assert.throws(() => selectedFiles({ files: Array(5).fill(file) }), /up to 4/);
  assert.throws(() => selectedFiles({ files: [{ ...file, size: 26 * 1024 * 1024 }] }), /25 MB/);
  assert.throws(() => selectedFiles({ files: Array(3).fill({ ...file, size: 20 * 1024 * 1024 }) }), /50 MB/);
});

test("upload preparation uses the same inferred type as the preview", async () => {
  const file = new File(["sample"], "clip.MOV");
  let metadata;
  await assert.rejects(uploadAttachments({ files: [file], messageId: "test", prepare: async (data) => {
    metadata = data;
    throw new Error("stop before network");
  } }), /stop before network/);
  assert.equal(metadata.type, "video/quicktime");
});

test("both composers wire previews and select the send button explicitly", () => {
  for (const [html, script, prefix] of [["admin.html", "src/admin.js", "admin-"], ["conversation.html", "conversation.js", ""]]) {
    const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    assert.ok(read(html).includes(`id="${prefix}message-attachment-previews"`));
    assert.ok(read(script).includes("renderAttachmentPreviews"));
    assert.ok(read(script).includes("setAttachmentBusy"));
    assert.ok(read(script).includes('querySelector("button[type=submit]")'));
  }
});
