import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardHandler } from "../netlify/functions/hmp-dashboard.mts";

globalThis.Netlify = { env: { get: key => key === "HMP_ADMIN_EMAILS" ? "admin@example.test" : undefined } };
const id = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const row = { submission_id: id, status: "New", client_name: "Example Client", internal_notes: "Keep these notes", priority: "High", owner: "HMP" };
  const calls = [];
  const db = { from(table) {
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
  return { row, db, calls, handler: createDashboardHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db }) };
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
