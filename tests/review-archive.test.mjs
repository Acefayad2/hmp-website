import test from "node:test";
import assert from "node:assert/strict";
import { createReviewHandler } from "../netlify/functions/hmp-reviews.mts";

globalThis.Netlify = { env: { get: key => key === "HMP_ADMIN_EMAILS" ? "admin@example.test" : "" } };
const id = "11111111-1111-4111-8111-111111111111";
const original = () => ({ id, reviewer_name: "Example Client", review_text: "Keep this review", published: true,
  archived_at: null, is_placeholder: false, source_request_id: "original-request", rating: 4 });
const request = (method = "GET", body, admin = false) => new Request(`https://hmpeds.com/api/hmp-reviews${admin ? "?admin=1" : ""}`, {
  method, headers: { Origin: "https://hmpeds.com" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
function setup(rows = [original()], user = { email: "admin@example.test" }, fail = false) {
  const database = { from(table) {
    assert.equal(table, "hmp_admin_reviews");
    let filters = [], payload, start = 0, end = Infinity;
    const query = {
      select() { return this; }, order() { return this; },
      limit(n) { end = n - 1; return this; },
      range(a, b) { start = a; end = b; return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      is(key, value) { filters.push(row => (row[key] ?? null) === value); return this; },
      not(key, op, value) { assert.equal(op, "is"); filters.push(row => (row[key] ?? null) !== value); return this; },
      update(value) { payload = value; return this; },
      delete() { assert.fail("A review must never be permanently deleted"); },
      result(single = false, required = false) {
        if (fail) return { data: null, error: { code: "TEST_ERROR" } };
        const found = rows.filter(row => filters.every(f => f(row))).slice(start, end + 1);
        if (payload) found.forEach(row => Object.assign(row, payload));
        return { data: single ? found[0] || null : found, error: required && !found.length ? { code: "PGRST116" } : null };
      },
      maybeSingle() { return Promise.resolve(this.result(true)); },
      single() { return Promise.resolve(this.result(true, true)); },
      then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); },
    };
    return query;
  } };
  return { rows, handler: createReviewHandler({ getUserFn: async () => user, databaseFactory: () => database }) };
}

test("DELETE archives without losing content or the original client request; public hides it and admin retains it", async () => {
  const { rows, handler } = setup();
  const response = await handler(request("DELETE", { id }));
  assert.equal(response.status, 200);
  assert.ok((await response.json()).review.archivedAt);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].review_text, "Keep this review");
  assert.equal(rows[0].source_request_id, "original-request");
  assert.equal(rows[0].published, false);
  assert.equal((await (await handler(request())).json()).reviews.length, 0);
  assert.equal((await (await handler(request("GET", undefined, true))).json()).reviews.length, 1);
  // Defensive filter also excludes an inconsistent historical archived+published row.
  rows[0].published = true;
  assert.equal((await (await handler(request())).json()).reviews.length, 0);
});

test("restoring is explicit and always unpublished, even with a spoofed publish flag", async () => {
  const { rows, handler } = setup();
  await handler(request("PATCH", { id, action: "archive" }));
  const response = await handler(request("PATCH", { id, action: "restore", published: true }));
  assert.equal(response.status, 200);
  assert.equal(rows[0].archived_at, null);
  assert.equal(rows[0].published, false);
  assert.equal((await (await handler(request())).json()).reviews.length, 0);
  // A delayed second restore must not unpublish an already-restored review.
  rows[0].published = true;
  assert.equal((await handler(request("PATCH", { id, action: "restore" }))).status, 404);
  assert.equal(rows[0].published, true);
});

test("a stale editor cannot edit or republish an archived review", async () => {
  const { rows, handler } = setup();
  await handler(request("DELETE", { id }));
  const response = await handler(request("PATCH", { id, reviewerName: "Changed", reviewText: "Changed", published: true }));
  assert.equal(response.status, 404);
  assert.equal(rows[0].reviewer_name, "Example Client");
  assert.equal(rows[0].published, false);
});

test("archive and restore require admin authorization, same origin and valid IDs", async () => {
  for (const [method, body] of [["DELETE", { id }], ["PATCH", { id, action: "restore" }]]) {
    const unauthorized = setup([original()], null);
    assert.equal((await unauthorized.handler(request(method, body))).status, 401);
    assert.equal(unauthorized.rows[0].archived_at, null);
    const { handler } = setup();
    assert.equal((await handler(new Request("https://hmpeds.com/api/hmp-reviews", { method, headers: { Origin: "https://evil.test" }, body: JSON.stringify(body) }))).status, 403);
    assert.equal((await handler(request(method, { ...body, id: "bad" }))).status, 400);
    assert.equal((await handler(request(method, null))).status, 400);
    assert.equal((await setup([]).handler(request(method, body))).status, 404);
    assert.equal((await setup([original()], { email: "admin@example.test" }, true).handler(request(method, body))).status, 502);
  }
});

test("admin pagination retains active and archived reviews beyond the old 100-row limit", async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ ...original(), id: String(i), archived_at: i % 2 ? "2026-09-29T00:00:00Z" : null }));
  const { handler } = setup(rows);
  const response = await handler(request("GET", undefined, true));
  assert.equal((await response.json()).reviews.length, 205);
});
