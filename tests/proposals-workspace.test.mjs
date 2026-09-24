import test from "node:test";
import assert from "node:assert/strict";
import { collectProposals } from "../src/proposals-workspace.js";
import { serializeProposal } from "../proposal-ui.js";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("proposal workspace lists only admin proposals newest first without modifying messages", () => {
  const proposal = serializeProposal({ title: "Event services", serviceFee: 1250 });
  const threads = [{ id: "one", messages: [
    { id: "old", sender: "admin", body: proposal, createdAt: "2026-09-01" },
    { id: "client", sender: "client", body: proposal },
    { id: "text", sender: "admin", body: "Hello" },
    { id: "bad", sender: "admin", body: "HMP_PROPOSAL_V1:{bad" },
  ] }, { id: "two", messages: [
    { id: "new", sender: "admin", body: proposal, createdAt: "2026-09-23" },
  ] }, { id: "empty" }];
  const original = JSON.stringify(threads);
  const records = collectProposals(threads);
  assert.deepEqual(records.map(({ message }) => message.id), ["new", "old"]);
  assert.equal(records[0].thread.id, "two");
  assert.equal(records[0].proposal.serviceFee, 1250);
  assert.equal(JSON.stringify(threads), original);
  assert.deepEqual(collectProposals(), []);
});

test("proposals refreshes using the existing authenticated conversations loader", () => {
  const source = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  const loader = source.slice(source.indexOf("const loadActiveWorkspace ="), source.indexOf("const syncActiveWorkspace ="));
  let calls = 0;
  runInNewContext(`const activeWorkspaceView = "proposals"; ${loader}; loadActiveWorkspace();`, { loadMessages: () => { calls++; } });
  assert.equal(calls, 1);
});
