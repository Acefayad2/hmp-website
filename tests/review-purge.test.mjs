import test from "node:test";
import assert from "node:assert/strict";
import { createPurgeHandler } from "../netlify/functions/purge-deleted-reviews.mts";

test("scheduled cleanup selects only reviews deleted at least 30 days ago", async () => {
  const calls = [];
  const cutoff = "2026-09-12T00:00:00.000Z";
  const client = { from(table) {
    assert.equal(table, "hmp_admin_reviews");
    const query = {
      select(value) { calls.push(["select", value]); return this; },
      not(...args) { calls.push(["not", ...args]); return this; },
      lte(...args) { calls.push(["lte", ...args]); return this; },
      order(...args) { calls.push(["order", ...args]); return this; },
      limit(value) { calls.push(["limit", value]); return Promise.resolve({ data: [{ id: "old-review" }], error: null }); },
      delete() { calls.push(["delete"]); return this; },
      in(...args) { calls.push(["in", ...args]); return this; },
      then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
    };
    return query;
  } };
  const handler = createPurgeHandler({ databaseFactory: () => client, now: () => Date.parse("2026-10-12T00:00:00.000Z") });
  assert.equal((await (await handler()).json()).purged, 1);
  assert.deepEqual(calls.filter((call) => call[0] === "lte"), [["lte", "deleted_at", cutoff], ["lte", "deleted_at", cutoff]]);
  assert.deepEqual(calls.find((call) => call[0] === "in"), ["in", "id", ["old-review"]]);
});
