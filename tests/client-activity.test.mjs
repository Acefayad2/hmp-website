import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientActivityItems } from "../client-activity.js";
import { renderHubTabs } from "../client-hub.js";

test("Activity is opt-in for Admin and absent from client hub tabs", () => {
  const original = globalThis.document;
  globalThis.document = {createElement: () => ({setAttribute(){}, addEventListener(event, callback){this.select = callback;}})};
  try {
    const container = {children: [], replaceChildren(){this.children=[];}, append(child){this.children.push(child);}};
    renderHubTabs(container, [], "messages", () => {});
    assert.ok(!container.children.some(tab => tab.textContent === "Activity"));
    let selected;
    renderHubTabs(container, [], "activity", section => {selected = section;}, {showActivity:true});
    const tab = container.children.find(tab => tab.textContent === "Activity");
    assert.ok(tab);
    tab.select();
    assert.equal(selected, "activity");
  } finally { globalThis.document = original; }
});

test("receipt activity is included without exposing another event's forms", () => {
  const forms = new Map([["other", {status:"Completed", completed_at:"2026-10-22"}]]);
  const items = clientActivityItems({messages:[{id:"receipt",sender:"admin",createdAt:"2026-10-23",document:{kind:"receipt",number:"R-1"}}]}, forms);
  assert.equal(items.length,1);
  assert.equal(items[0].title,"Receipt R-1");
});

test("Admin activity lives inside the event hub, with no duplicate sidebar workspace", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="hub-activity"') > html.indexOf('id="admin-hub-tabs"'));
  assert.ok(!html.includes('id="activity-workspace"'));
  assert.ok(!html.includes('data-workspace-view="activity"'));
  assert.match(source, /showActivity: true/);
  assert.match(source, /if \(requestedView === "activity"\)/);
  assert.match(source, /requestId !== activityFormsRequest \|\| activeThreadId !== thread.id/);
});

test("activity stays within one inquiry and includes shared and completed documents", () => {
  const thread = { messages: [
    { id: "proposal", sender: "admin", body: 'HMP_PROPOSAL_V1:{"title":"Guest Seating Experience"}', createdAt: "2026-10-01T10:00:00Z" },
    { id: "form", sender: "admin", document: { kind: "form", id: "form-1", title: "Event details" }, createdAt: "2026-10-02T10:00:00Z" },
    { id: "invoice", sender: "admin", document: { kind: "invoice", number: "HMP-42" }, createdAt: "2026-10-03T10:00:00Z" },
    { id: "contract", sender: "admin", document: { kind: "contract", number: "HMP-C1", client_signed_at: "2026-10-05T12:00:00Z" }, createdAt: "2026-10-03T11:00:00Z" },
    { id: "client", sender: "client", body: "Thanks", createdAt: "2026-10-04T10:00:00Z" },
    { id: "seating", sender: "admin", document: { kind: "seating" }, createdAt: "2026-10-06T10:00:00Z" },
  ] };
  const forms = new Map([["form-1", { status: "Completed", completed_at: "2026-10-05T10:00:00Z" }]]);
  const items = clientActivityItems(thread, forms, [{id:"seat-change",at:"2026-10-07T10:00:00Z",title:"Guest added",detail:"Jane Doe · Table 2"}]);
  assert.deepEqual(items.map((item) => item.detail), [
    "Jane Doe · Table 2", "Shared with client", "Signed by client", "Completed by client", "Sent to HMP", "Shared with client", "Shared with client", "Shared with client", "Proposal shared with client",
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
  assert.match(client, /article\.append\(renderProposalMessage\(proposal\)\)/);
  assert.match(admin, /article\.append\(renderProposalMessage\(proposal\)\)/);
  assert.match(proposal, /open\.textContent = "View proposal"/);
  assert.match(proposal, /dialog\.showModal\(\)/);
});
