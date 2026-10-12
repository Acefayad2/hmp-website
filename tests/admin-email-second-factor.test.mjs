import test from "node:test";
import assert from "node:assert/strict";
import {
  clearAdminSecondFactorCookie,
  isAdminSecondFactorVerified,
  verifiedAdminCookie,
} from "../netlify/functions/_admin-second-factor.mts";
import { createAdminEmailCodeHandler } from "../netlify/functions/hmp-admin-email-code.mts";
import { createMessagesHandler } from "../netlify/functions/hmp-messages.mts";

const settings = {
  HMP_ADMIN_EMAILS: "admin@example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-private-key",
  RESEND_API_KEY: "test-only-resend-key",
  HMP_INQUIRY_FROM_EMAIL: "security@example.test",
};
globalThis.Netlify = { env: { get: (key) => settings[key] } };
const user = { id: "admin-user-id", email: "admin@example.test" };
const endpoint = "https://hmpeds.com/api/hmp-admin-email-code";
const request = (action, code, cookie = "") => new Request(endpoint, {
  method: "POST",
  headers: { Origin: "https://hmpeds.com", Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({ action, code }),
});

const fakeDatabase = () => {
  let row = null;
  return {
    from(table) {
      assert.equal(table, "hmp_admin_email_challenges");
      let filters = [], operation = "read", payload;
      const query = {
        select() { return this; },
        eq(key, value) { filters.push((candidate) => candidate[key] === value); return this; },
        gt(key, value) { filters.push((candidate) => candidate[key] > value); return this; },
        update(value) { operation = "update"; payload = value; return this; },
        insert(value) { operation = "insert"; payload = value; return this; },
        async maybeSingle() {
          let found = row && filters.every((filter) => filter(row)) ? row : null;
          if (operation === "insert") {
            if (row) return { data: null, error: { code: "23505" } };
            row = { ...payload }; found = row;
          }
          if (operation === "update" && found) Object.assign(found, payload);
          return { data: found, error: null };
        },
        then(resolve, reject) { return this.maybeSingle().then(resolve, reject); },
      };
      return query;
    },
  };
};

test("admin verification cookie is bound to the allowed account, signed, and expires", () => {
  const now = Date.now();
  const cookie = verifiedAdminCookie(user, settings.SUPABASE_SERVICE_ROLE_KEY, now).split(";")[0];
  const req = new Request(endpoint, { headers: { Cookie: cookie } });
  assert.equal(isAdminSecondFactorVerified(req, user, settings.SUPABASE_SERVICE_ROLE_KEY, now), true);
  assert.equal(isAdminSecondFactorVerified(req, { ...user, id: "other" }, settings.SUPABASE_SERVICE_ROLE_KEY, now), false);
  assert.equal(isAdminSecondFactorVerified(req, user, "wrong-key", now), false);
  assert.equal(isAdminSecondFactorVerified(req, user, settings.SUPABASE_SERVICE_ROLE_KEY, now + 12 * 60 * 60 * 1000), false);
  assert.match(clearAdminSecondFactorCookie(), /Max-Age=0/);
});

test("email codes are limited, single-use, and required before Admin API access", async () => {
  const db = fakeDatabase();
  let now = Date.now();
  const sent = [];
  const handler = createAdminEmailCodeHandler({
    getUserFn: async () => user,
    databaseFactory: () => db,
    nowFn: () => now,
    fetchFn: async (_url, options) => { sent.push(JSON.parse(options.body)); return Response.json({ id: "sent" }); },
  });
  const status = await handler(new Request(endpoint));
  assert.deepEqual(await status.json(), { verified: false });
  assert.equal((await handler(request("send"))).status, 200);
  assert.deepEqual(sent[0].to, [user.email]);
  const code = sent[0].text.match(/code is (\d{6})/)[1];
  assert.equal((await handler(request("send"))).status, 429);
  assert.equal((await handler(request("verify", "999999"))).status, 401);
  const verified = await handler(request("verify", code));
  assert.equal(verified.status, 200);
  const cookie = verified.headers.get("set-cookie").split(";")[0];
  assert.equal(isAdminSecondFactorVerified(new Request(endpoint, { headers: { Cookie: cookie } }), user), true);
  assert.equal((await handler(request("verify", code))).status, 401);
  now += 61_000;
  assert.equal((await handler(request("send"))).status, 200);
  const nextCode = sent[1].text.match(/code is (\d{6})/)[1];
  now += 10 * 60_000;
  assert.equal((await handler(request("verify", nextCode))).status, 401);
});

test("unlisted users and cross-site requests cannot request a code", async () => {
  const handler = createAdminEmailCodeHandler({
    getUserFn: async () => ({ id: "other", email: "other@example.test" }),
    databaseFactory: fakeDatabase,
  });
  assert.equal((await handler(request("send"))).status, 401);
  assert.equal((await handler(new Request(endpoint, {
    method: "POST", headers: { Origin: "https://evil.test" }, body: '{"action":"send"}',
  }))).status, 403);
});

test("five bad guesses consume a code, and only five emails can be requested per hour", async () => {
  const db = fakeDatabase();
  let now = Date.now();
  const emails = [];
  const handler = createAdminEmailCodeHandler({
    getUserFn: async () => user,
    databaseFactory: () => db,
    nowFn: () => now,
    fetchFn: async (_url, options) => { emails.push(JSON.parse(options.body)); return Response.json({}); },
  });
  assert.equal((await handler(request("send"))).status, 200);
  const code = emails[0].text.match(/code is (\d{6})/)[1];
  const badCode = code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt++)
    assert.equal((await handler(request("verify", badCode))).status, 401);
  assert.equal((await handler(request("verify", code))).status, 401);
  for (let send = 1; send < 5; send++) {
    now += 61_000;
    assert.equal((await handler(request("send"))).status, 200);
  }
  now += 61_000;
  assert.equal((await handler(request("send"))).status, 429);
  assert.equal(emails.length, 5);
  now += 60 * 60_000;
  assert.equal((await handler(request("send"))).status, 200);
});

test("an Admin password session alone cannot read private messages", async () => {
  const handler = createMessagesHandler({ getUserFn: async () => user });
  const response = await handler(new Request("https://hmpeds.com/api/hmp-messages"));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "MFA_REQUIRED");
});
