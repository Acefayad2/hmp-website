import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createProposalDirtyState } from "../src/proposal-dirty-state.js";

test("proposal edits stay dirty through a failed save and clear only after a successful retry", () => {
  let open = true;
  let proposal = { title: "Original", notes: "" };
  const state = createProposalDirtyState({ read: () => proposal, isOpen: () => open });

  state.begin();
  assert.equal(state.isDirty(), false);
  proposal = { ...proposal, notes: "Keep this note" };
  assert.equal(state.isDirty(), true);

  // A failed save does not call markSaved, so navigation must remain guarded.
  assert.equal(state.isDirty(), true);
  const submitted = proposal;
  proposal = { ...proposal, notes: "Typed while saving" };
  state.markSaved(submitted);
  assert.equal(state.isDirty(), true);
  state.markSaved(proposal);
  assert.equal(state.isDirty(), false);

  proposal = { ...proposal, title: "Edited after save" };
  assert.equal(state.isDirty(), true);
  open = false;
  assert.equal(state.isDirty(), false);
});

test("proposal dirty state resets after discard or send without stale repeated warnings", () => {
  let proposal = { title: "Original" };
  const state = createProposalDirtyState({ read: () => proposal, isOpen: () => true });

  state.begin();
  proposal = { title: "Discard me" };
  assert.equal(state.isDirty(), true);
  state.reset();
  assert.equal(state.isDirty(), false);
  state.reset();
  assert.equal(state.isDirty(), false);

  state.begin();
  proposal = { title: "Send me" };
  assert.equal(state.isDirty(), true);
  state.reset();
  assert.equal(state.isDirty(), false);
});

test("admin proposal exits share the dirty guard and successful saves and sends clear it", () => {
  const source = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  assert.match(source, /closeProposalEditor = \(\{ confirmDiscard = true \} = \{\}\)/);
  assert.match(source, /Discard your unsaved proposal changes\?/);
  assert.match(source, /\$\("#close-proposal-editor-bottom"\)\.addEventListener\("click", \(\) => closeProposalEditor\(\)\)/);
  assert.match(source, /proposalDirtyState\.markSaved\(payload\)/);
  assert.match(source, /closeProposalEditor\(\{ confirmDiscard: false \}\)/);
  assert.match(source, /pendingFiles\([\s\S]*proposalDirtyState\.isDirty\(\)/);
  assert.match(source, /addEventListener\("cancel", \(event\) => \{\s*event\.preventDefault\(\);\s*closeProposalEditor\(\)/);
  assert.match(source, /if \(!setWorkspaceView[\s\S]*history\.pushState\(\{ view: activeWorkspaceView \}/);
  const sender = source.slice(source.indexOf("const sendProposal ="), source.indexOf("const openMessageThread ="));
  assert.ok(sender.indexOf("closeProposalEditor({ confirmDiscard: false })") < sender.indexOf('const draftResponse = await fetch("/api/hmp-proposal-drafts"'));
  assert.ok(sender.indexOf('const saved=await fetch("/api/hmp-proposal-drafts"') < sender.indexOf('fetch("/api/hmp-messages"'));
  assert.match(sender, /await loadMessages\(\)\.catch/);
  assert.match(sender, /#admin-message-status[\s\S]*postSendWarnings\.join/);
  assert.match(sender, /activeWorkspaceView === "drafts"[\s\S]*#drafts-status/);
});

test("proposal footer Close is desktop-only and cannot submit a proposal", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../admin.css", import.meta.url), "utf8");
  assert.match(html, /id="close-proposal-editor" type="button">Close/);
  assert.match(html, /class="proposal-form-actions"[\s\S]*id="close-proposal-editor-bottom" type="button">Close/);
  assert.equal((html.match(/id="close-proposal-editor-bottom"/g) || []).length, 1);
  assert.match(css, /#close-proposal-editor-bottom \{ display:none; \}/);
  assert.match(css, /@media \(min-width:801px\) \{\s*#close-proposal-editor-bottom \{ display:inline-flex;/);
});
