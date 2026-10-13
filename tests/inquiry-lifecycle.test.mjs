import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardHandler } from "../netlify/functions/hmp-dashboard.mts";

globalThis.Netlify = { env: { get: (key) => key === "HMP_ADMIN_EMAILS" ? "admin@example.test" : "" } };
const id = "11111111-1111-4111-8111-111111111111";
const request = (status, origin = "https://hmpeds.com") => new Request("https://hmpeds.com/api/hmp-dashboard", {
  method: "PATCH",
  headers: { Origin: origin },
  body: JSON.stringify({ id, status, priority: "Normal", followUpDate: "", owner: "", internalNotes: "" }),
});

function setup(user = { email: "admin@example.test" }) {
  const rows = [{ submission_id: id, client_name: "Test Client", status: "New", priority: "Normal", received_at: "2026-10-13T00:00:00Z" }];
  const database = { from(table) {
    assert.equal(table, "hmp_admin_inquiries");
    let payload = null, filter = () => true;
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      eq(key, value) { filter = (row) => row[key] === value; return this; },
      update(value) { payload = value; return this; },
      single: async () => {
        const row = rows.find(filter);
        if (row && payload) Object.assign(row, payload);
        return { data: row || null, error: row ? null : { code: "PGRST116" } };
      },
      then(resolve, reject) { return Promise.resolve({ data: rows.filter(filter), error: null }).then(resolve, reject); },
    };
    return query;
  } };
  return { rows, handler: createDashboardHandler({ getUserFn: async () => user, databaseFactory: () => database }) };
}

test("closed, archived, deleted and restored inquiries keep their original record", async () => {
  const { rows, handler } = setup();
  for (const status of ["Closed", "Archived", "Deleted", "New"]) {
    const response = await handler(request(status));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).inquiry.status, status);
    assert.equal(rows[0].status, status);
    assert.equal(rows[0].client_name, "Test Client");
  }
  assert.equal(rows.length, 1);
});

test("inquiry changes require an authorized admin and same-origin request", async () => {
  const { handler, rows } = setup();
  assert.equal((await setup(null).handler(request("Closed"))).status, 401);
  assert.equal((await setup({ email: "other@example.test" }).handler(request("Closed"))).status, 401);
  assert.equal((await handler(request("Closed", "https://other.example"))).status, 403);
  assert.equal((await handler(request("Invalid"))).status, 400);
  assert.equal((await handler(new Request("https://hmpeds.com/api/hmp-dashboard", { method: "PATCH", headers: { Origin: "https://hmpeds.com" }, body: "null" }))).status, 400);
  assert.equal(rows[0].status, "New");
});
