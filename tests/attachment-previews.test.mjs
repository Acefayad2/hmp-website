import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attachmentType, selectedFiles, uploadAttachments, stageAttachments, clearStagedAttachments, removeStagedAttachment, pendingFiles } from "../attachment-ui.js";

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

test("client conversation policy permits local image and PDF previews without permitting script blobs", () => {
  const config = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  const section = config.split('for = "/conversation*"')[1].split("[[headers]]")[0];
  const policy = section.match(/Content-Security-Policy = "([^"]+)"/)[1];
  const directives = Object.fromEntries(policy.split(";").map(value => {
    const [name, ...sources] = value.trim().split(/\s+/); return [name, sources];
  }));
  assert.ok(directives["img-src"].includes("blob:"));
  assert.deepEqual(directives["frame-src"], ["blob:"]);
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["frame-ancestors"], ["'none'"]);
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
    assert.ok(read(script).includes("stageAttachments"));
    assert.ok(read(script).includes("clearStagedAttachments"));
    assert.match(read(html),/type="file" multiple/);
    assert.ok(read(script).includes('querySelector("button[type=submit]")'));
  }
});

test("files remain local, accumulate across picker selections, and can be removed before sending", () => {
  const a=new File(["a"],"a.png",{type:"image/png",lastModified:1});
  const b=new File(["b"],"b.png",{type:"image/png",lastModified:2});
  const c=new File(["c"],"c.pdf",{type:"application/pdf",lastModified:3});
  const input={files:[a,b],value:"selection",disabled:false};
  stageAttachments(input);assert.equal(input.value,"");assert.deepEqual(selectedFiles(input),[a,b]);
  input.files=[b,c];stageAttachments(input);assert.deepEqual(selectedFiles(input),[a,b,c]);
  input.files=[];stageAttachments(input);assert.deepEqual(selectedFiles(input),[a,b,c]);
  removeStagedAttachment(input,1);assert.deepEqual(selectedFiles(input),[a,c]);
  input.files=[b];stageAttachments(input);assert.deepEqual(selectedFiles(input),[a,c,b]);
  clearStagedAttachments(input);assert.deepEqual(pendingFiles(input),[]);
});

test("invalid queued selections remain removable and queues are isolated between composers", () => {
  const files=Array.from({length:5},(_,i)=>new File(["image"],`${i}.png`,{type:"image/png"}));
  const input={files,disabled:false},other={files:[],disabled:false};
  stageAttachments(input);assert.throws(()=>selectedFiles(input),/up to 4/);
  assert.equal(pendingFiles(input).length,5);assert.equal(pendingFiles(other).length,0);
  removeStagedAttachment(input,0);assert.equal(selectedFiles(input).length,4);
  input.disabled=true;removeStagedAttachment(input,0);input.files=[];stageAttachments(input);
  assert.equal(selectedFiles(input).length,4);
});
