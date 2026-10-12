import test from "node:test";
import assert from "node:assert/strict";
import { createMessageSignatureHandler } from "../netlify/functions/hmp-message-signature.mts";
import { insertMessageSignature } from "../src/message-signature.mjs";

globalThis.Netlify = { env: { get: key => ({
  HMP_ADMIN_EMAILS: "admin@example.test",
  SUPABASE_URL: "https://database.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-only",
})[key] } };

const database = () => {
  let row = null;
  let fail = false;
  return {
    set fail(value) { fail = value; },
    from(table) {
      assert.equal(table, "hmp_admin_message_signature");
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: fail ? null : row, error: fail ? { message: "offline" } : null }),
        upsert(payload) { row = payload; return this; },
        single: async () => ({ data: fail ? null : row, error: fail ? { message: "offline" } : null }),
      };
    },
  };
};

const makeHandler = (db, user = { email: "ADMIN@example.test" }) => createMessageSignatureHandler({
  getUserFn: async () => user,
  databaseFactory: () => db,
  verifySecondFactorFn: () => true,
});
const request = (method, body, origin = "https://hmpeds.com") => new Request("https://hmpeds.com/api/hmp-message-signature", {
  method,
  headers: { Origin: origin },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("only a signed-in, allowlisted admin can read or save the message signature", async () => {
  const db = database();
  assert.equal((await makeHandler(db, null)(request("GET"))).status, 401);
  assert.equal((await makeHandler(db, { email: "other@example.test" })(request("GET"))).status, 401);
  assert.equal((await makeHandler(db)(request("PUT", { signature: "Hello" }, "https://other.test"))).status, 403);
  assert.equal((await makeHandler(db)(request("DELETE"))).status, 405);
});

test("signature saves across reloads, preserves line breaks, and can be cleared", async () => {
  const db = database(), handler = makeHandler(db);
  assert.equal((await (await handler(request("GET"))).json()).signature, "");
  const saved = await handler(request("PUT", { signature: "  Best,\nHMP team  " }));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).signature, "Best,\nHMP team");
  assert.equal((await (await handler(request("GET"))).json()).signature, "Best,\nHMP team");
  assert.equal((await handler(request("PUT", { signature: "" }))).status, 200);
  assert.equal((await (await handler(request("GET"))).json()).signature, "");
});

test("invalid, overlong, or unavailable signatures fail without false success", async () => {
  const db = database(), handler = makeHandler(db);
  assert.equal((await handler(request("PUT", { signature: 5 }))).status, 400);
  assert.equal((await handler(request("PUT", { signature: "x".repeat(1001) }))).status, 400);
  db.fail = true;
  assert.equal((await handler(request("GET"))).status, 502);
  assert.equal((await handler(request("PUT", { signature: "HMP" }))).status, 502);
});

test("inserting a signature is optional, editable, bounded, and never duplicates the ending", () => {
  assert.deepEqual(insertMessageSignature("Hello", "Best,\nHMP"), { message: "Hello\n\nBest,\nHMP", error: "" });
  assert.equal(insertMessageSignature("", "Best,\nHMP").message, "Best,\nHMP");
  assert.match(insertMessageSignature("Hello\n\nBest,\nHMP", "Best,\nHMP").error, /already/);
  assert.match(insertMessageSignature("Hello", "").error, /Save/);
  assert.match(insertMessageSignature("12345", "Goodbye", 10).error, /too long/);
});
