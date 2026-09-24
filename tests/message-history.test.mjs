import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readMessageHistory } from "../netlify/functions/_message-history.mts";

function fixture(count, failAt = -1) {
  const calls = [];
  const database = { from(table) {
    assert.equal(table, "hmp_client_messages");
    return {
      select() { return this; },
      in(column, ids) { assert.equal(column, "conversation_id"); assert.deepEqual(ids, ["authorized-conversation"]); return this; },
      order() { return this; },
      async range(from, to) {
        calls.push([from, to]);
        if (from === failAt) return { data: null, error: { message: "read failed" } };
        return { data: Array.from({ length: Math.max(0, Math.min(to + 1, count) - from) }, (_, i) => ({ id: from + i, body: from + i === count - 1 ? "latest proposal" : "message" })), error: null };
      },
    };
  } };
  return { database, calls };
}

test("message history includes the latest record beyond both old row limits", async () => {
  for (const count of [0, 500, 501, 2001]) {
    const { database, calls } = fixture(count);
    const result = await readMessageHistory(database, ["authorized-conversation"], "id,body");
    assert.equal(result.error, null);
    assert.equal(result.data.length, count);
    assert.equal(new Set(result.data.map(row => row.id)).size, count);
    if (count) assert.equal(result.data.at(-1).body, "latest proposal");
    assert.equal(calls.length, Math.floor(count / 500) + 1);
  }
});

test("a later-page failure never returns a misleading partial conversation", async () => {
  const { database } = fixture(2001, 500);
  const result = await readMessageHistory(database, ["authorized-conversation"], "id");
  assert.equal(result.data, null);
  assert.equal(result.error.message, "read failed");
});

test("empty scope performs no query and both authorized endpoints use pagination", async () => {
  const { database, calls } = fixture(0);
  assert.deepEqual(await readMessageHistory(database, [], "id"), { data: [], error: null });
  assert.equal(calls.length, 0);
  for (const file of ["hmp-conversation.mts", "hmp-messages.mts"]) {
    assert.match(readFileSync(new URL(`../netlify/functions/${file}`, import.meta.url), "utf8"), /await readMessageHistory|readMessageHistory\(client/);
  }
});
