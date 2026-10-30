import test from "node:test";
import assert from "node:assert/strict";
import { receiptDraftPayload } from "../receipt-draft.mjs";
import { createReceiptDraftHandler } from "../netlify/functions/hmp-receipt-drafts.mts";
import { collectDraftGroups } from "../src/drafts-workspace.js";

globalThis.Netlify = { env: { get: key => ({ HMP_ADMIN_EMAILS: "admin@example.test",
  SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only" })[key] } };
const invoiceId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const endpoint = "https://hmpeds.com/api/hmp-receipt-drafts";
const request = (body, origin = "https://hmpeds.com") => new Request(endpoint, {
  method: "POST", headers: { Origin: origin }, body: JSON.stringify(body),
});

function database() {
  const rows = { hmp_admin_receipt_drafts: [], hmp_admin_invoices: [{ id: invoiceId, status: "Sent", deleted_at: null }] };
  const writes = [];
  return { rows, writes, from(table) {
    let filters = [], mode = "read", change;
    return {
      select() { return this; }, order() { return this; }, limit() { return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      insert(value) { mode = "insert"; change = value; return this; },
      update(value) { mode = "update"; change = value; return this; },
      result(one = false) {
        let found = rows[table].filter(row => filters.every(filter => filter(row)));
        if (mode !== "read") writes.push(table);
        if (mode === "insert") { const row = { id: draftId, revision: 1, ...change, created_at: "2026-10-17" }; rows[table].push(row); found = [row]; }
        if (mode === "update") found.forEach(row => Object.assign(row, change));
        return { data: one ? found[0] || null : found, error: null };
      },
      maybeSingle() { return Promise.resolve(this.result(true)); },
      then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); },
    };
  } };
}
const handler = (db, email = "admin@example.test") => createReceiptDraftHandler({ getUserFn: async () => ({ email }), databaseFactory: () => db });

test("receipt drafts allow missing invoice/payment details but never store confirmation or invoice values", () => {
  const payload = receiptDraftPayload({ note: " Unfinished ", confirmed: true, total: 500, clientName: "Injected" });
  assert.deepEqual(payload, { amountPaid: "", paymentDate: "", paymentMethod: "", reference: "", note: "Unfinished" });
  assert.equal(receiptDraftPayload({ amountPaid: "0" }).amountPaid, "0");
  for (const input of [null, [], { amountPaid: "1e2" }, { amountPaid: "1.111" }, { note: "x".repeat(1001) }, { paymentDate: "2026-02-30" }, { paymentMethod: "Invalid" }, { reference: {} }]) assert.throws(() => receiptDraftPayload(input));
});

test("receipt drafts save, list, and update with optimistic concurrency without changing invoices", async () => {
  const db = database(), handle = handler(db);
  const saved = await (await handle(request({ payload: { note: "Retainer" } }))).json();
  assert.equal(saved.draft.invoiceId, null);
  assert.equal(saved.draft.revision, 1);
  const update = { id: draftId, revision: 1, invoiceId, payload: { amountPaid: "400.50", confirmed: true } };
  const updated = await (await handle(request(update))).json();
  assert.equal(updated.draft.revision, 2);
  assert.equal(updated.draft.payload.amountPaid, "400.50");
  assert.equal(updated.draft.payload.confirmed, undefined);
  assert.equal((await handle(request(update))).status, 409);
  const listed = await handle(new Request(endpoint));
  assert.equal(listed.headers.get("Cache-Control"), "no-store");
  assert.equal((await listed.json()).drafts[0].revision, 2);
  assert.ok(db.writes.every(table => table === "hmp_admin_receipt_drafts"));
  assert.equal(db.rows.hmp_admin_invoices[0].status, "Sent");
});

test("receipt draft writes reject outsiders, cross-origin requests, invalid IDs, missing revisions and oversized input", async () => {
  const db = database(), handle = handler(db);
  for (const email of ["", "client@example.test"]) {
    assert.equal((await handler(db, email)(request({ payload: {} }))).status, 401);
    assert.equal((await handler(db, email)(new Request(endpoint))).status, 401);
  }
  assert.equal((await handle(request({}, "https://other.test"))).status, 403);
  assert.equal((await handle(request({ invoiceId: "bad" }))).status, 400);
  assert.equal((await handle(request({ id: draftId }))).status, 400);
  assert.equal((await handle(request({ payload: { note: "x".repeat(64001) } }))).status, 413);
  assert.equal((await handle(request({ payload: { note: "x".repeat(1001) } }))).status, 400);
  assert.equal((await handle(request([]))).status, 400);
  assert.equal(db.writes.length, 0);
});

test("receipt drafts accept draft invoices but reject missing, deleted and voided invoices", async () => {
  const db = database(), handle = handler(db);
  db.rows.hmp_admin_invoices[0].status = "Draft";
  assert.equal((await handle(request({ invoiceId, payload: {} }))).status, 200);
  db.rows.hmp_admin_invoices[0].status = "Void";
  assert.equal((await handle(request({ invoiceId, payload: {} }))).status, 409);
  db.rows.hmp_admin_invoices[0].status = "Sent";
  db.rows.hmp_admin_invoices[0].deleted_at = "2026-10-17";
  assert.equal((await handle(request({ invoiceId, payload: {} }))).status, 409);
  assert.equal((await handle(request({ invoiceId: draftId, payload: {} }))).status, 409);
});

test("standalone drafts persist client details without an invoice and never store payment confirmation", async () => {
  const db = database(), handle = handler(db);
  const payload = { receiptMode: "standalone", receiptNumber: "R-QA", clientName: "QA Client", eventName: "QA event", serviceDescription: "Guest services", amountPaid: "100", confirmed: true };
  const saved = await (await handle(request({ payload }))).json();
  assert.equal(saved.draft.invoiceId, null); assert.equal(saved.draft.clientName, "QA Client");
  assert.equal(saved.draft.eventName, "QA event"); assert.equal(saved.draft.payload.confirmed, undefined);
  const listed = (await (await handle(new Request(endpoint))).json()).drafts[0];
  assert.equal(listed.payload.receiptNumber, "R-QA"); assert.equal(listed.payload.serviceDescription, "Guest services");
  const group = collectDraftGroups({ receipts: [listed] }).find(group => group.kind === "receipt");
  assert.equal(group.rows[0].title, "Standalone receipt — R-QA"); assert.equal(group.rows[0].client, "QA Client");
  assert.equal((await handle(request({ invoiceId, payload }))).status, 400);
  assert.ok(db.writes.every(name => name === "hmp_admin_receipt_drafts"));
  assert.equal(db.rows.hmp_admin_invoices.length, 1);
  assert.equal(receiptDraftPayload({ receiptMode: "standalone" }).clientName, "", "incomplete standalone drafts remain allowed");
  assert.throws(() => receiptDraftPayload({ receiptMode: "unknown" }));
});
