import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientActivityItems } from "../client-activity.js";

test("activity stays within one inquiry and includes shared and completed documents", () => {
  const thread = { messages: [
    { id: "proposal", sender: "admin", body: 'HMP_PROPOSAL_V1:{"title":"Guest Seating Experience"}', createdAt: "2026-10-01T10:00:00Z" },
    { id: "form", sender: "admin", document: { kind: "form", id: "form-1", title: "Event details" }, createdAt: "2026-10-02T10:00:00Z" },
    { id: "invoice", sender: "admin", document: { kind: "invoice", number: "HMP-42" }, createdAt: "2026-10-03T10:00:00Z" },
    { id: "client", sender: "client", body: "Thanks", createdAt: "2026-10-04T10:00:00Z" },
    { id: "seating", sender: "admin", document: { kind: "seating" }, createdAt: "2026-10-06T10:00:00Z" },
  ] };
  const forms = new Map([["form-1", { status: "Completed", completed_at: "2026-10-05T10:00:00Z" }]]);
  const items = clientActivityItems(thread, forms, [{id:"seat-change",at:"2026-10-07T10:00:00Z",title:"Guest added",detail:"Jane Doe · Table 2"}]);
  assert.deepEqual(items.map((item) => item.detail), [
    "Jane Doe · Table 2", "Shared with client", "Completed by client", "Sent to HMP", "Shared with client", "Shared with client", "Proposal shared with client",
  ]);
  assert.equal(items.some((item) => item.title === "Invoice HMP-42"), true);
  assert.deepEqual(clientActivityItems({ messages: [] }, forms), []);
});

test("client and admin message threads start with messages, with full proposals opened on demand", () => {
  const client = readFileSync(new URL("../conversation.js", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  const proposal = readFileSync(new URL("../proposal-ui.js", import.meta.url), "utf8");
  assert.match(client, /let activeHubSection = "messages"/);
  assert.match(admin, /let activeHubSection = "messages"/);
  assert.match(client, /article\.append\(renderProposalPreview\(proposal\)\)/);
  assert.match(admin, /article\.append\(renderProposalPreview\(proposal\)\)/);
  assert.match(proposal, /open\.textContent = "View proposal"/);
  assert.match(proposal, /dialog\.showModal\(\)/);
});
