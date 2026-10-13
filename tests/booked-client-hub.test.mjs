import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDashboardHandler } from "../netlify/functions/hmp-dashboard.mts";

const inquiryId = "11111111-1111-4111-8111-111111111111";
globalThis.Netlify = { env: { get: (key) => ({ HMP_ADMIN_EMAILS: "admin@example.test", SUPABASE_SERVICE_ROLE_KEY: "test-secret" })[key] } };

const request = (status, origin = "https://hmpeds.com") => new Request("https://hmpeds.com/api/hmp-dashboard", {
  method: "PATCH",
  headers: { Origin: origin },
  body: JSON.stringify({ id: inquiryId, status, priority: "Normal", followUpDate: "", owner: "", internalNotes: "" }),
});

function database() {
  const inquiries = [{ submission_id: inquiryId, status: "New", client_name: "Client" }];
  const conversations = [];
  let failHub = false;
  return {
    inquiries, conversations,
    set failHub(value) { failHub = value; },
    from(table) {
      if (table === "hmp_client_conversations") return {
        upsert(value, options) {
          assert.deepEqual(options, { onConflict: "inquiry_id", ignoreDuplicates: true });
          if (failHub) return Promise.resolve({ error: { code: "TEST_FAILURE" } });
          if (!conversations.some((row) => row.inquiry_id === value.inquiry_id)) conversations.push(value);
          return Promise.resolve({ error: null });
        },
      };
      assert.equal(table, "hmp_admin_inquiries");
      let changes, id;
      return {
        update(value) { changes = value; return this; },
        eq(key, value) { assert.equal(key, "submission_id"); id = value; return this; },
        select() { return this; },
        single() {
          const row = inquiries.find((item) => item.submission_id === id);
          if (!row) return Promise.resolve({ data: null, error: { code: "PGRST116" } });
          Object.assign(row, changes);
          return Promise.resolve({ data: { ...row }, error: null });
        },
      };
    },
  };
}

test("booking creates exactly one private client hub without rotating an existing link", async () => {
  const db = database();
  const handler = createDashboardHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db });
  assert.equal((await handler(request("Booked"))).status, 200);
  assert.equal(db.inquiries[0].status, "Booked");
  assert.equal(db.conversations.length, 1);
  const original = { ...db.conversations[0] };
  assert.equal(original.inquiry_id, inquiryId);
  assert.match(original.access_token_hash, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(original.token_expires_at) > Date.now());
  assert.equal((await handler(request("Booked"))).status, 200);
  assert.deepEqual(db.conversations, [original]);
  assert.equal((await handler(request("Closed"))).status, 200);
  assert.deepEqual(db.conversations, [original]);
});

test("only an authorized same-origin Admin can book, and old workflow statuses cannot be selected", async () => {
  const db = database();
  const handler = createDashboardHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db });
  const denied = createDashboardHandler({ getUserFn: async () => null, databaseFactory: () => db });
  assert.equal((await denied(request("Booked"))).status, 401);
  assert.equal((await handler(request("Booked", "https://other.test"))).status, 403);
  assert.equal((await handler(request("Contacted"))).status, 400);
  assert.equal((await handler(request("Quoted"))).status, 400);
  assert.equal(db.conversations.length, 0);
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const options = html.match(/<select id="manage-status"[\s\S]*?<\/select>/)?.[0] || "";
  assert.match(options, /<option>New<\/option>[\s\S]*<option>Booked<\/option>[\s\S]*<option>Closed<\/option>/);
  assert.doesNotMatch(options, /<option>Contacted<\/option>|<option>Quoted<\/option>/);
});

test("a failed hub insert reports a retryable warning without denying a saved booking", async () => {
  const db = database();
  db.failHub = true;
  const handler = createDashboardHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db });
  const response = await handler(request("Booked"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).hubWarning.includes("Save again to retry"), true);
  assert.equal(db.inquiries[0].status, "Booked");
  db.failHub = false;
  assert.equal((await handler(request("Booked"))).status, 200);
  assert.equal(db.conversations.length, 1);
});
