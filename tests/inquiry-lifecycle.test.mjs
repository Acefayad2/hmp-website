import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardHandler, ensureBookedHub } from "../netlify/functions/hmp-dashboard.mts";

globalThis.Netlify = { env: { get: key => ({ HMP_ADMIN_EMAILS: "admin@example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only-secret" })[key] } };
const id = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const row = { submission_id: id, status: "New", client_name: "Example Client", internal_notes: "Keep these notes", priority: "High", owner: "HMP" };
  const calls = [];
  const hubs = [];
  let hubFailure = false;
  const db = { from(table) {
    if (table === "hmp_client_conversations") {
      let inquiryId;
      return {
        select() { return this; },
        eq(key, value) { assert.equal(key, "inquiry_id"); inquiryId = value; return this; },
        async maybeSingle() { return { data: hubs.find(hub => hub.inquiry_id === inquiryId) || null, error: hubFailure ? { code: "failure" } : null }; },
        async upsert(value, options) {
          assert.deepEqual(options, { onConflict: "inquiry_id", ignoreDuplicates: true });
          if (!hubs.some(hub => hub.inquiry_id === value.inquiry_id)) hubs.push(value);
          return { error: null };
        },
      };
    }
    assert.equal(table, "hmp_admin_inquiries");
    let patch, filters = [];
    return {
      update(value) { patch = value; calls.push(value); return this; },
      eq(key, value) { filters.push(record => record[key] === value); return this; },
      select() { return this; },
      async maybeSingle() {
        if (!filters.every(match => match(row))) return { data: null, error: null };
        Object.assign(row, patch);
        return { data: { ...row }, error: null };
      },
      single() { return this.maybeSingle(); },
    };
  } };
  return { row, db, calls, hubs, failHub: value => { hubFailure = value; }, handler: createDashboardHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db }) };
}
const request = (body, origin = "https://hmpeds.com") => new Request("https://hmpeds.com/api/hmp-dashboard", {
  method: "PATCH", headers: origin ? { Origin: origin } : {}, body: JSON.stringify(body),
});

test("archive, recoverable delete, and restore change only status and timestamp", async () => {
  const { row, calls, handler } = fixture();
  for (const [action, expectedStatus, target] of [["archive", "New", "Archived"], ["delete", "Archived", "Deleted"], ["restore", "Deleted", "New"]]) {
    const response = await handler(request({ id, action, expectedStatus }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).inquiry.status, target);
    assert.equal(row.status, target);
    assert.equal(row.internal_notes, "Keep these notes");
    assert.equal(row.priority, "High");
    assert.equal(row.owner, "HMP");
    assert.deepEqual(Object.keys(calls.at(-1)).sort(), ["status", "updated_at"]);
  }
});

test("direct deletion and restoring archived inquiries are supported", async () => {
  const { row, handler } = fixture();
  assert.equal((await handler(request({ id, action: "delete", expectedStatus: "New" }))).status, 200);
  row.status = "Archived";
  assert.equal((await handler(request({ id, action: "restore", expectedStatus: "Archived" }))).status, 200);
  assert.equal(row.status, "New");
});

test("unauthenticated or non-admin users cannot access the database", async () => {
  for (const user of [null, { email: "client@example.test" }]) {
    const handler = createDashboardHandler({ getUserFn: async () => user, databaseFactory: () => { throw new Error("Must not access database"); } });
    assert.equal((await handler(request({ id, action: "delete", expectedStatus: "New" }))).status, 401);
  }
});

test("cross-origin, missing-origin, malformed, invalid and prototype actions are rejected", async () => {
  const { handler, row } = fixture();
  for (const origin of ["https://evil.example", ""]) assert.equal((await handler(request({ id }, origin))).status, 403);
  for (const body of [null, [], {}, { id, action: "toString", expectedStatus: "New" }, { id, action: "delete", expectedStatus: "unknown" }]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  const invalid = new Request("https://hmpeds.com/api/hmp-dashboard", { method: "PATCH", headers: { Origin: "https://hmpeds.com" }, body: "{" });
  assert.equal((await handler(invalid)).status, 400);
  assert.equal(row.status, "New");
});

test("stale status, missing records and invalid lifecycle transitions cannot overwrite records", async () => {
  const { handler, row } = fixture();
  for (const body of [
    { id, action: "archive", expectedStatus: "Booked" },
    { id: "22222222-2222-4222-8222-222222222222", action: "archive", expectedStatus: "New" },
    { id, action: "restore", expectedStatus: "New" },
    { id, action: "archive", expectedStatus: "Deleted" },
    { id, action: "delete", expectedStatus: "Deleted" },
  ]) assert.equal((await handler(request(body))).status, 409);
  assert.equal(row.status, "New");
});

test("database failures return a safe error and do not claim success", async () => {
  const { db } = fixture();
  const from = db.from.bind(db);
  db.from = table => ({ ...from(table), maybeSingle: async () => ({ data: null, error: { code: "failure" } }) });
  const handler = createDashboardHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db });
  assert.equal((await handler(request({ id, action: "archive", expectedStatus: "New" }))).status, 502);
});

test("normal saves support all statuses while preserving legacy status compatibility", async () => {
  const { handler } = fixture();
  for (const status of ["New", "Contacted", "Quoted", "Booked", "Closed", "Archived"]) {
    const response = await handler(request({ id, status, priority: "Normal", internalNotes: "Updated notes" }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).inquiry.status, status);
  }
  assert.equal((await handler(request({ id, status: "Deleted", priority: "Normal" }))).status, 400);
});

test("booking automatically creates one event hub and repeat saves preserve its credentials", async () => {
  const { handler, hubs } = fixture();
  const save = () => handler(request({ id, status: "Booked", priority: "Normal" }));
  const result = await (await save()).json();
  assert.equal(result.conversationId, hubs[0].id);
  assert.equal(result.hubWarning, undefined);
  assert.equal(hubs[0].inquiry_id, id);
  assert.match(hubs[0].access_token_hash, /^[a-f0-9]{64}$/);
  const original = structuredClone(hubs[0]);
  await save();
  assert.deepEqual(hubs, [original]);
});

test("booking preserves revoked links, expired links and PIN fields instead of renewing access", async () => {
  const { handler, hubs } = fixture();
  const original = { id: "existing", inquiry_id: id, token_nonce: "unchanged", token_expires_at: "2020-01-01", revoked_at: "2020-01-01", client_pin_hash: "unchanged" };
  hubs.push(structuredClone(original));
  const result = await (await handler(request({ id, status: "Booked", priority: "Normal" }))).json();
  assert.equal(result.conversationId, "existing");
  assert.deepEqual(hubs, [original]);
});

test("hub failures report a saved booking with a retry warning, then recover safely", async () => {
  const { handler, row, hubs, failHub } = fixture();
  failHub(true);
  const result = await (await handler(request({ id, status: "Booked", priority: "Normal" }))).json();
  assert.equal(row.status, "Booked");
  assert.match(result.hubWarning, /Booking saved.*Press Save again/);
  assert.equal(result.conversationId, undefined);
  assert.equal(hubs.length, 0);
  failHub(false);
  const recovered = await (await handler(request({ id, status: "Booked", priority: "Normal" }))).json();
  assert.equal(recovered.conversationId, hubs[0].id);
});

test("concurrent bookings create one hub; different inquiries never share a hub", async () => {
  const { db, hubs } = fixture();
  const ids = await Promise.all([ensureBookedHub(db, id), ensureBookedHub(db, id)]);
  assert.equal(ids[0], ids[1]);
  assert.equal(hubs.length, 1);
  const other = await ensureBookedHub(db, "22222222-2222-4222-8222-222222222222");
  assert.notEqual(other, ids[0]);
  assert.equal(hubs.length, 2);
});

test("non-booking saves do not create hubs", async () => {
  const { handler, hubs } = fixture();
  for (const status of ["New", "Contacted", "Quoted", "Closed", "Archived"]) {
    await handler(request({ id, status, priority: "Normal" }));
  }
  assert.equal(hubs.length, 0);
});
