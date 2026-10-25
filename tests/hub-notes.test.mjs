import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDashboardHandler } from "../netlify/functions/hmp-dashboard.mts";
import { hubSections, renderHubTabs } from "../client-hub.js";
import { mountHubNotes } from "../src/hub-notes.js";

globalThis.Netlify = { env: { get: key => key === "HMP_ADMIN_EMAILS" ? "admin@example.test" : undefined } };
const id = "11111111-1111-4111-8111-111111111111";
const version = "2026-10-24T12:00:00.000Z";
const request = (body, origin = "https://hmpeds.com") => new Request("https://hmpeds.com/api/hmp-dashboard", {
  method: "PATCH", headers: { Origin: origin }, body: JSON.stringify(body),
});
function fixture() {
  const row = { submission_id: id, internal_notes: "Meeting notes", updated_at: version, status: "Booked", owner: "HMP" };
  const writes = [];
  let fail = false;
  const db = { from(table) {
    assert.equal(table, "hmp_admin_inquiries");
    let patch, filters = [];
    return {
      update(value) { patch = value; return this; },
      eq(key, value) { filters.push(record => record[key] === value); return this; },
      is(key, value) { return this.eq(key, value); },
      select() { return this; },
      async maybeSingle() {
        if (fail) return { error: { code: "FAIL" } };
        if (!filters.every(match => match(row))) return { data: null };
        writes.push(patch); Object.assign(row, patch);
        return { data: { ...row } };
      },
    };
  } };
  return { row, writes, fail: () => { fail = true; }, handler: createDashboardHandler({ getUserFn: async () => ({ email: "admin@example.test" }), databaseFactory: () => db }) };
}
const body = { id, action: "save-notes", internalNotes: "Updated meeting notes", expectedVersion: version };

test("save updates only private notes and timestamp; stale edits cannot replace newer notes", async () => {
  const f = fixture();
  const response = await f.handler(request(body));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).inquiry.internalNotes, body.internalNotes);
  assert.deepEqual(Object.keys(f.writes[0]).sort(), ["internal_notes", "updated_at"]);
  assert.equal(f.row.status, "Booked");
  assert.equal(f.row.owner, "HMP");
  assert.equal((await f.handler(request({ ...body, internalNotes: "stale" }))).status, 409);
  assert.equal(f.row.internal_notes, body.internalNotes);
});

test("notes require verified Admin, same origin, valid text and a version", async () => {
  for (const user of [null, { email: "client@example.test" }]) {
    const h = createDashboardHandler({ getUserFn: async () => user, databaseFactory: () => { throw Error("No DB access"); } });
    assert.equal((await h(request(body))).status, 401);
  }
  const f = fixture();
  assert.equal((await f.handler(request(body, "https://other.test"))).status, 403);
  for (const change of [{ internalNotes: 2 }, { internalNotes: "x".repeat(5001) }, { expectedVersion: undefined }, { expectedVersion: "invalid" }])
    assert.equal((await f.handler(request({ ...body, ...change }))).status, 400);
  assert.equal(f.writes.length, 0);
});

test("empty notes, legacy null timestamps, missing records and DB failures are safe", async () => {
  const f = fixture();
  f.row.updated_at = null;
  assert.equal((await f.handler(request({ ...body, expectedVersion: null, internalNotes: "" }))).status, 200);
  assert.equal(f.row.internal_notes, null);
  assert.equal((await f.handler(request({ ...body, id: "22222222-2222-4222-8222-222222222222" }))).status, 409);
  f.fail();
  assert.equal((await f.handler(request(body))).status, 502);
});

const element = () => ({ value: "", textContent: "", disabled: false, events: {}, children: [],
  addEventListener(name, callback) { this.events[name] = callback; }, setAttribute() {},
  replaceChildren() { this.children = []; }, append(child) { this.children.push(child); }, reportValidity: () => true,
});
test("Notes is an Admin opt-in, absent from client tabs and public response", () => {
  globalThis.document = { createElement: element };
  const tabs = element();
  renderHubTabs(tabs, [], "all", () => {});
  assert.ok(!tabs.children.some(child => child.textContent === "Notes"));
  assert.ok(!hubSections.some(([key]) => key === "notes"));
  renderHubTabs(tabs, [], "notes", () => {}, { showNotes: true });
  assert.ok(tabs.children.some(child => child.textContent === "Notes"));
  const clientApi = readFileSync(new URL("../netlify/functions/hmp-conversation.mts", import.meta.url), "utf8");
  assert.ok(!clientApi.includes("internal_notes"));
  assert.ok(!clientApi.includes("internalNotes"));
});

test("editor preserves per-event drafts on refresh/switch; errors retain text and successful saves clear dirty state", async () => {
  const events = {};
  globalThis.window = { addEventListener: (name, fn) => { events[name] = fn; }, confirm: () => true };
  const form = element(), input = element(), saveButton = element(), reloadButton = element(), status = element();
  let saved, fail = true;
  const first = { inquiryId: id, internalNotes: "Original", notesVersion: version };
  const editor = mountHubNotes({ form, input, saveButton, reloadButton, status,
    loadThreads: async () => [{ ...first, internalNotes: "Server latest" }], onSaved: value => { saved = value; } });
  editor.open(first);
  input.value = "Unsaved"; input.events.input();
  editor.open({ ...first, internalNotes: "Someone else's new note" });
  assert.equal(input.value, "Unsaved");
  editor.open({ ...first, inquiryId: "other", internalNotes: "Other event" });
  assert.equal(input.value, "Other event");
  editor.open(first);
  assert.equal(input.value, "Unsaved");
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/hmp-dashboard");
    assert.equal(JSON.parse(options.body).expectedVersion, version);
    return fail ? Response.json({ error: "Conflict: copy notes and reload" }, { status: 409 })
      : Response.json({ inquiry: { id, internalNotes: "Unsaved", notesVersion: "2026-10-25T12:00:00Z" } });
  };
  await form.events.submit({ preventDefault() {} });
  assert.equal(input.value, "Unsaved"); assert.match(status.textContent, /Conflict/);
  let warned = false;
  events.beforeunload({ preventDefault() { warned = true; } }); assert.ok(warned);
  fail = false;
  await form.events.submit({ preventDefault() {} });
  assert.equal(saved.internalNotes, "Unsaved"); assert.ok(saveButton.disabled);
  warned = false;
  events.beforeunload({ preventDefault() { warned = true; } }); assert.equal(warned, false);
  await reloadButton.events.click();
  assert.equal(input.value, "Server latest");
});
