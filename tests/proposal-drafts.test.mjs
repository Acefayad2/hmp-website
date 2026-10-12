import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createProposalDraftsHandler, cleanProposalDraft } from "../netlify/functions/hmp-proposal-drafts.mts";
import { serializeProposal } from "../proposal-ui.js";

const id = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const otherConversationId = "33333333-3333-4333-8333-333333333333";
globalThis.Netlify = { env: { get: (key) => key === "HMP_ADMIN_EMAILS" ? "admin@example.test" : "" } };

const database = () => {
  const rows = {
    hmp_client_conversations: [{ id: conversationId }, { id: otherConversationId }],
    hmp_admin_proposal_drafts: [],
    hmp_client_messages: [],
  };
  return { rows, from(table) {
    let filters = [], operation = "read", payload;
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      eq(key, value) { filters.push((row) => row[key] === value); return this; },
      is(key, value) { filters.push((row) => (row[key] ?? null) === value); return this; },
      insert(value) { operation = "insert"; payload = value; return this; },
      update(value) { operation = "update"; payload = value; return this; },
      result(single = false) {
        let found = rows[table].filter((row) => filters.every((filter) => filter(row)));
        if (operation === "insert") {
          const row = { ...payload, sent_at: null, created_at: "2026-10-11T12:00:00Z", updated_at: "2026-10-11T12:00:00Z" };
          rows[table].push(row);
          found = [row];
        }
        if (operation === "update") found.forEach((row) => Object.assign(row, payload));
        return { data: single ? found[0] || null : found, error: null };
      },
      maybeSingle() { return Promise.resolve(this.result(true)); },
      then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); },
    };
    return query;
  } };
};

const request = (body, origin = "https://hmpeds.com") => new Request("https://hmpeds.com/api/hmp-proposal-drafts", {
  method: "POST", headers: { Origin: origin }, body: JSON.stringify(body),
});

test("proposal drafts are admin-only, private, editable, and sendable only after a matching proposal exists", async () => {
  const db = database();
  const handler = createProposalDraftsHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db });
  const denied = createProposalDraftsHandler({ getUserFn: async () => null, databaseFactory: () => db });
  const draft = { action: "save", id, conversationId, content: { title: "Gala", serviceFee: "900", notes: "First version", extra: "not stored" } };
  assert.equal((await denied(request(draft))).status, 401);
  assert.equal((await handler(request(draft, "https://evil.test"))).status, 403);
  assert.equal((await handler(request({ ...draft, conversationId: crypto.randomUUID() }))).status, 404);
  assert.equal((await handler(request(draft))).status, 200);
  assert.equal(db.rows.hmp_client_messages.length, 0);
  assert.equal(db.rows.hmp_admin_proposal_drafts[0].content.notes, "First version");
  assert.equal("extra" in db.rows.hmp_admin_proposal_drafts[0].content, false);
  assert.equal((await handler(request({ ...draft, conversationId: otherConversationId }))).status, 404);
  assert.equal((await handler(request({ ...draft, content: { ...draft.content, notes: "Revised" } }))).status, 200);
  const list = await (await handler(new Request("https://hmpeds.com/api/hmp-proposal-drafts"))).json();
  assert.equal(list.drafts.length, 1);
  assert.equal(list.drafts[0].content.notes, "Revised");
  const mark = { action: "mark-sent", id, conversationId };
  assert.equal((await handler(request(mark))).status, 404);
  db.rows.hmp_client_messages.push({ id, conversation_id: conversationId, sender: "admin", body: "Ordinary message" });
  assert.equal((await handler(request(mark))).status, 404);
  db.rows.hmp_client_messages[0].body = serializeProposal({ title: "Gala", clientName: "Client", serviceFee: 900 });
  assert.equal((await handler(request({ ...mark, conversationId: otherConversationId }))).status, 404);
  assert.equal((await handler(request(mark))).status, 200);
  assert.equal((await (await handler(new Request("https://hmpeds.com/api/hmp-proposal-drafts"))).json()).drafts.length, 0);
  assert.equal((await handler(request(draft))).status, 409);
  assert.equal((await (await handler(request(mark))).json()).alreadySent, true);
});

test("draft save preserves incomplete fields but never accepts arbitrary keys", () => {
  const content = cleanProposalDraft({ title: "", serviceFee: "", paymentTerms: "", adminOnly: "private" });
  assert.equal(content.title, "");
  assert.equal(content.serviceFee, "");
  assert.equal("adminOnly" in content, false);
});

test("proposal editor exposes save draft separately from send and reuses the draft ID for retry-safe delivery", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  assert.match(html, /id="save-proposal-draft"[^>]*type="button"/);
  assert.match(source, /requestId: draft\.id/);
  assert.match(source, /action: "mark-sent"/);
  assert.match(source, /loadProposalDrafts\(\)/);
});
