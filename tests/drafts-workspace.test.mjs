import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectDraftGroups } from "../src/drafts-workspace.js";
import { createProposalDraftHandler } from "../netlify/functions/hmp-proposal-drafts.mts";

globalThis.Netlify = { env: { get: key => ({
  HMP_ADMIN_EMAILS: "admin@example.test", SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only",
})[key] } };
const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const draftId = "33333333-3333-4333-8333-333333333333";

function database() {
  const rows = { hmp_admin_proposal_drafts: [], hmp_client_conversations: [{ id: conversationId }],
    hmp_client_messages: [{ id: messageId, sender: "admin", conversation_id: conversationId }] };
  return { rows, async rpc(name,args){
    assert.equal(name,"hmp_mark_proposal_revision_sent");
    const message=rows.hmp_client_messages.find(r=>r.id===args.p_message_id&&r.conversation_id===args.p_conversation_id&&r.sender==="admin");
    const draft=rows.hmp_admin_proposal_drafts.find(r=>r.id===args.p_id&&r.conversation_id===args.p_conversation_id);
    if(!message||!draft)return {data:false,error:null};
    draft.sent_at="2026-10-18";draft.sent_message_id=message.id;
    return {data:true,error:null};
  }, from(table) {
    const source = rows[table];
    let filters = [], change = null, mode = "read";
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      is(key, value) { filters.push(row => (row[key] ?? null) === value); return this; },
      insert(value) { mode = "insert"; change = value; return this; },
      update(value) { mode = "update"; change = value; return this; },
      result(one = false) {
        let found = source.filter(row => filters.every(filter => filter(row)));
        if (mode === "insert") { const row = { id: draftId, ...change, created_at: "2026-10-12", updated_at: "2026-10-12", sent_at: null }; source.push(row); found = [row]; }
        if (mode === "update") found.forEach(row => Object.assign(row, change));
        return { data: one ? found[0] || null : found, error: null };
      },
      maybeSingle() { return Promise.resolve(this.result(true)); },
      then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); },
    };
    return query;
  } };
}
const request = (body, origin = "https://hmpeds.com") => new Request("https://hmpeds.com/api/hmp-proposal-drafts", {
  method: "POST", headers: { Origin: origin }, body: JSON.stringify(body),
});

test("Drafts groups saved records by type and excludes sent, archived, and deleted records", () => {
  const groups = collectDraftGroups({
    proposals: [{ id: "p", payload: { title: "Gala" }, updatedAt: "2026-10-12" }],
    invoices: [{ id: "i", status: "Draft" }, { id: "sent", status: "Sent" }, { id: "archived", status: "Draft", archivedAt: "now" }],
    contracts: [{ id: "c", status: "Draft" }],
    receipts: [{ id: "r", invoiceNumber: "HMP-1", clientName: "Test Client", payload: {} }],
    forms: [{ id: "f", status: "Draft", template_id: "money-event-information" }, { id: "complete", status: "Completed", template_id: "money-event-information" }],
  });
  assert.deepEqual(groups.map(group => [group.title, group.rows.map(row => row.id)]), [
    ["Proposals", ["p"]], ["Invoices", ["i"]], ["Payment receipts", ["r"]], ["Contracts", ["c"]], ["Client forms & agreements", ["f"]],
  ]);
});

test("proposal drafts are admin-only, private until sent, and editable after saving", async () => {
  const db = database();
  const handle = createProposalDraftHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db });
  const denied = createProposalDraftHandler({ getUserFn: async () => ({ email: "client@example.test" }), databaseFactory: () => db });
  const save = { action: "save", conversationId, payload: { title: "Gala", clientName: "Alex" } };
  assert.equal((await denied(request(save))).status, 401);
  assert.equal((await handle(request(save, "https://wrong.test"))).status, 403);
  assert.equal((await handle(request({ ...save, conversationId: messageId }))).status, 404);
  const saved = await handle(request(save));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).draft.id, draftId);
  assert.equal(db.rows.hmp_client_messages.length, 1, "saving does not send a client message");
  assert.equal((await handle(request({ ...save, id: draftId, payload: { title: "Updated Gala" } }))).status, 200);
  assert.equal(db.rows.hmp_admin_proposal_drafts[0].payload.title, "Updated Gala");
  const listed = await handle(new Request("https://hmpeds.com/api/hmp-proposal-drafts"));
  assert.equal((await listed.json()).drafts.length, 1);
  assert.equal((await handle(request({ action: "mark-sent", id: draftId, conversationId, messageId: draftId }))).status, 502);
  assert.equal((await handle(request({ action: "mark-sent", id: draftId, conversationId, messageId }))).status, 200);
  const after = await handle(new Request("https://hmpeds.com/api/hmp-proposal-drafts"));
  assert.deepEqual((await after.json()).drafts, []);
});

test("Drafts has a sidebar route, grouped view, save control, and search", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  const search = readFileSync(new URL("../src/admin-search.js", import.meta.url), "utf8");
  assert.match(html, /data-workspace-view="drafts">Drafts<\/a>/);
  assert.match(html, /id="drafts-groups"/);
  assert.match(html, /id="save-proposal-draft"/);
  assert.match(source, /activeWorkspaceView === "drafts"\) return loadDrafts\(\)/);
  assert.match(search, /\["drafts", "Search drafts"/);
});

test("N/A and zero equipment persist through saving, reopening and updating a proposal draft", async () => {
  const db = database();
  const handle = createProposalDraftHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db });
  const payload = { title: "Guest Seating", clientName: "Sample Client", serviceHours: "n/a", associates: "", machines: 0 };
  const saved = await handle(request({ action: "save", conversationId, payload }));
  assert.equal(saved.status, 200);
  const list = await (await handle(new Request("https://hmpeds.com/api/hmp-proposal-drafts"))).json();
  assert.equal(list.drafts[0].payload.serviceHours, "N/A");
  assert.equal(list.drafts[0].payload.associates, 0);
  assert.equal(list.drafts[0].payload.machines, 0);
  await handle(request({ action: "save", id: draftId, conversationId, payload: { ...payload, serviceHours: 4.5, associates: 2 } }));
  assert.equal(db.rows.hmp_admin_proposal_drafts[0].payload.serviceHours, 4.5);
  assert.equal(db.rows.hmp_admin_proposal_drafts[0].payload.associates, 2);
});
