import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMessagesHandler } from "../netlify/functions/hmp-messages.mts";
import { createSmsHandler } from "../netlify/functions/hmp-sms.mts";
import { sendQuoMessage, toE164 } from "../netlify/functions/_quo.mts";

const settings = {
  QUO_API_KEY: "test-quo-key",
  QUO_FROM_NUMBER: "",
  QUO_PHONE_NUMBER_ID: "",
  QUO_API_BASE: "",
  HMP_ADMIN_EMAILS: "admin@example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-secret",
  SUPABASE_URL: "https://example.test",
};
globalThis.Netlify = { env: { get: (key) => settings[key] } };

const inquiryId = "33333333-3333-4333-8333-333333333333";
const conversationId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const messageId = "44444444-4444-4444-8444-444444444444";

function memoryDb(seed = {}) {
  const tables = {
    hmp_admin_inquiries: seed.inquiries || [],
    hmp_client_conversations: seed.conversations || [],
    hmp_client_messages: seed.messages || [],
    hmp_sms_messages: seed.sms || [],
  };
  return {
    tables,
    from(table) {
      const rows = tables[table];
      if (!rows) throw new Error(`Missing table ${table}`);
      const filters = [];
      let op = "select";
      let payload = null;
      let countMode = false;
      const query = {
        select(_columns, options) { countMode = Boolean(options?.head); return this; },
        order() { return this; },
        limit() { return this; },
        range() { return this; },
        eq(column, value) { filters.push((row) => row[column] === value); return this; },
        neq(column, value) { filters.push((row) => row[column] !== value); return this; },
        is(column, value) { filters.push((row) => (row[column] ?? null) === value); return this; },
        gte(column, value) { filters.push((row) => String(row[column] ?? "") >= String(value)); return this; },
        in(column, values) { filters.push((row) => values.includes(row[column])); return this; },
        not(column, operator, value) {
          if (operator === "is") filters.push((row) => (row[column] ?? null) !== value);
          return this;
        },
        insert(value) { op = "insert"; payload = value; return this; },
        update(value) { op = "update"; payload = value; return this; },
        execute(single = false) {
          let found = rows.filter((row) => filters.every((filter) => filter(row)));
          if (op === "insert") {
            if (rows.some((row) => (payload.id && row.id === payload.id) || (payload.request_id && row.request_id === payload.request_id))) {
              return { data: null, error: { code: "23505" }, count: 0 };
            }
            const row = { ...payload, created_at: payload.created_at || new Date().toISOString() };
            rows.push(row);
            found = [row];
          }
          if (op === "update") found.forEach((row) => Object.assign(row, payload));
          if (countMode) return { data: null, error: null, count: found.length };
          return { data: single ? found[0] || null : found, error: null, count: found.length };
        },
        maybeSingle() { return Promise.resolve(this.execute(true)); },
        then(resolve, reject) { return Promise.resolve(this.execute(false)).then(resolve, reject); },
      };
      return query;
    },
  };
}

const hana = () => ({
  submission_id: inquiryId,
  client_name: "Hana",
  phone: "(240) 437-9163",
  status: "New",
});

const request = (body, origin = "https://hmpeds.com") => new Request("https://hmpeds.com/api/hmp-sms", {
  method: "POST",
  headers: { Origin: origin },
  body: JSON.stringify(body),
});

const handler = (db, fetchFn, user = { email: "admin@example.test", name: "Avery" }) =>
  createSmsHandler({ getUserFn: async () => user, databaseFactory: () => db, fetchFn });

const quoOk = (calls) => async (url, options) => {
  calls.push({ url, options });
  return Response.json({ data: { id: "quo-message-1" } });
};

test("phone numbers normalize to E.164 and reject incomplete values", () => {
  assert.equal(toE164("(240) 437-9163"), "+12404379163");
  assert.equal(toE164("2404379163"), "+12404379163");
  assert.equal(toE164("1-240-437-9163"), "+12404379163");
  assert.equal(toE164("+12404379163"), "+12404379163");
  assert.equal(toE164("437-9163"), "");
  assert.equal(toE164("not a phone"), "");
});

test("Quo is called with the raw API key, default from number, and JSON body", async () => {
  const calls = [];
  const result = await sendQuoMessage({ to: "555-010-1234", content: " Hello ", fetchFn: quoOk(calls) });
  assert.equal(result.to, "+15550101234");
  assert.equal(result.from, "+14437855238");
  assert.equal(result.providerId, "quo-message-1");
  assert.equal(calls[0].url, "https://api.openphone.com/v1/messages");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "test-quo-key");
  assert.equal(String(calls[0].options.headers.Authorization).startsWith("Bearer "), false);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    from: "+14437855238",
    to: ["+15550101234"],
    content: "Hello",
  });
});

test("optional Quo settings are honored and a missing key never calls Quo", async () => {
  settings.QUO_FROM_NUMBER = "+15555550199";
  settings.QUO_PHONE_NUMBER_ID = "PN123";
  settings.QUO_API_BASE = "https://quo.test/v1/";
  const calls = [];
  try {
    await sendQuoMessage({ to: "+15555550100", content: "Hi", fetchFn: quoOk(calls) });
    assert.equal(calls[0].url, "https://quo.test/v1/messages");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      from: "+15555550199",
      to: ["+15555550100"],
      content: "Hi",
      phoneNumberId: "PN123",
    });
    settings.QUO_API_KEY = "";
    await assert.rejects(sendQuoMessage({ to: "+15555550100", content: "Hi", fetchFn: quoOk(calls) }), /QUO_API_KEY/);
    assert.equal(calls.length, 1);
  } finally {
    settings.QUO_API_KEY = "test-quo-key";
    settings.QUO_FROM_NUMBER = "";
    settings.QUO_PHONE_NUMBER_ID = "";
    settings.QUO_API_BASE = "";
  }
});

test("Quo errors stay free of the API key and do not claim the text was sent", async () => {
  const calls = [];
  await assert.rejects(
    sendQuoMessage({
      to: "+15555550100",
      content: "Hi",
      fetchFn: async () => {
        calls.push("called");
        return Response.json({ message: `rejected ${settings.QUO_API_KEY}` }, { status: 422 });
      },
    }),
    (error) => {
      assert.equal(error.status, 502);
      assert.match(error.message, /did not accept/);
      assert.equal(error.message.includes(settings.QUO_API_KEY), false);
      return true;
    },
  );
  await assert.rejects(
    sendQuoMessage({ to: "+15555550100", content: "Hi", fetchFn: async () => { throw new Error("socket"); } }),
    /not sent/,
  );
});

test("a signed-in staff member can text a contact number and the text is logged in that conversation", async () => {
  const calls = [];
  const db = memoryDb({ inquiries: [hana()] });
  const response = await handler(db, quoOk(calls))(request({
    to: "+12404379163",
    contactName: "Hana",
    content: "Hello from HMP",
    requestId,
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.to, "+12404379163");
  assert.equal(body.from, "+14437855238");
  assert.equal(body.savedToConversation, true);
  assert.equal(body.providerId, "quo-message-1");
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).to[0], "+12404379163");
  assert.equal(db.tables.hmp_sms_messages.length, 1);
  assert.equal(db.tables.hmp_sms_messages[0].status, "sent");
  assert.equal(db.tables.hmp_sms_messages[0].contact_name, "Hana");
  assert.equal(db.tables.hmp_sms_messages[0].created_by, "admin@example.test");
  assert.equal(db.tables.hmp_client_messages.length, 1);
  assert.equal(db.tables.hmp_client_messages[0].body, "Hello from HMP");
  assert.equal(db.tables.hmp_client_messages[0].sender_name, "Avery");
  assert.equal(db.tables.hmp_client_conversations.length, 1);
  const duplicate = await handler(db, quoOk(calls))(request({
    to: "+12404379163",
    contactName: "Hana",
    content: "Hello from HMP",
    requestId,
  }));
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(calls.length, 1);
  assert.equal(db.tables.hmp_client_messages.length, 1);
});

test("conversation texts use the saved inquiry phone and a mismatched number is refused", async () => {
  const calls = [];
  const db = memoryDb({
    inquiries: [{ ...hana(), phone: "+15555550123" }],
    conversations: [{ id: conversationId, inquiry_id: inquiryId }],
  });
  const h = handler(db, quoOk(calls));
  const mismatch = await h(request({ conversationId, to: "+12404379163", content: "Wrong number", requestId }));
  assert.equal(mismatch.status, 409);
  assert.equal(calls.length, 0);
  assert.equal(db.tables.hmp_sms_messages.length, 0);
  const sent = await h(request({ conversationId, content: "See you there", requestId }));
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).to, "+15555550123");
  assert.equal(JSON.parse(calls[0].options.body).to[0], "+15555550123");
  assert.equal(db.tables.hmp_client_messages[0].conversation_id, conversationId);
});

test("a Quo failure is logged and does not create a conversation message", async () => {
  const db = memoryDb({ inquiries: [hana()], conversations: [{ id: conversationId, inquiry_id: inquiryId }] });
  const response = await handler(db, async () => Response.json({ message: "line not approved" }, { status: 403 }))(request({
    conversationId,
    content: "Hello",
    requestId,
  }));
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.match(body.error, /QUO_API_KEY|A2P/);
  assert.equal(body.error.includes(settings.QUO_API_KEY), false);
  assert.equal(db.tables.hmp_sms_messages[0].status, "failed");
  assert.equal(db.tables.hmp_client_messages.length, 0);
});

test("texts require an admin session, the HMP origin, and a configured key", async () => {
  const calls = [];
  const db = memoryDb({ inquiries: [hana()] });
  assert.equal((await handler(db, quoOk(calls), null)(request({ to: "+12404379163", content: "Hi" }))).status, 401);
  assert.equal((await handler(db, quoOk(calls))(request({ to: "+12404379163", content: "Hi" }, "https://evil.test"))).status, 403);
  settings.QUO_API_KEY = "";
  try {
    const missing = await handler(db, quoOk(calls))(request({ to: "+12404379163", content: "Hi", requestId }));
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /QUO_API_KEY/);
  } finally {
    settings.QUO_API_KEY = "test-quo-key";
  }
  assert.equal(calls.length, 0);
  assert.equal(db.tables.hmp_client_messages.length, 0);
});

test("the per-minute limit refuses another text before calling Quo", async () => {
  const calls = [];
  const sms = Array.from({ length: 30 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    request_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    status: "sent",
    created_at: new Date().toISOString(),
    to_number: "+15555550100",
    from_number: "+14437855238",
    body: "earlier",
  }));
  const db = memoryDb({ sms });
  const response = await handler(db, quoOk(calls))(request({ to: "+12404379163", content: "One more" }));
  assert.equal(response.status, 429);
  assert.equal(calls.length, 0);
  assert.equal(db.tables.hmp_sms_messages.length, 30);
});

test("a sent text cannot be edited from the conversation", async () => {
  const messages = [{ id: messageId, conversation_id: conversationId, sender: "admin", body: "Hello", deleted_at: null }];
  const db = memoryDb({
    messages,
    sms: [{ id: requestId, request_id: requestId, message_id: messageId, status: "sent" }],
  });
  const editor = createMessagesHandler({
    getUserFn: async () => ({ email: "admin@example.test" }),
    databaseFactory: () => db,
    fetchFn: async () => { throw new Error("No email expected"); },
  });
  const edit = new Request("https://hmpeds.com/api/hmp-messages", {
    method: "POST",
    headers: { Origin: "https://hmpeds.com" },
    body: JSON.stringify({ action: "edit-message", conversationId, messageId, message: "Changed" }),
  });
  const response = await editor(edit);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /cannot be edited/);
  assert.equal(messages[0].body, "Hello");
});

test("the CRM offers texting beside email and keeps the Quo key in the environment", () => {
  const admin = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  const reviews = readFileSync(new URL("../src/review-requests-admin.js", import.meta.url), "utf8");
  const quo = readFileSync(new URL("../netlify/functions/_quo.mts", import.meta.url), "utf8");
  assert.match(admin, /Text client/);
  assert.match(admin, /Send text/);
  assert.match(admin, /Text current link/);
  assert.match(admin, /Text review link/);
  assert.match(script, /\/api\/hmp-sms/);
  assert.match(reviews, /\/api\/hmp-sms/);
  assert.match(quo, /readSetting\("QUO_API_KEY"\)/);
  assert.match(quo, /Netlify\.env\.get\(name\)/);
  assert.doesNotMatch(quo, /Authorization:\s*`Bearer/);
  assert.doesNotMatch(quo, /sk_[A-Za-z0-9]{8,}/);
});
