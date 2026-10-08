import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

function fixture(responses) {
  const source = read("script.js");
  const code = source.slice(
    source.indexOf('const form = document.querySelector("#inquiry-form")'),
    source.indexOf('document.querySelectorAll("#year")'),
  );
  const classes = new Set();
  const status = {
    textContent: "",
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
    },
  };
  const submit = { disabled: false, textContent: "", innerHTML: "" };
  const submissionId = { value: "" };
  let submitHandler;
  let resetCount = 0;
  const form = {
    addEventListener: (name, handler) => { if (name === "submit") submitHandler = handler; },
    querySelector: (selector) => selector === "[type=submit]" ? submit : submissionId,
    reset: () => { resetCount += 1; },
  };
  let timeout;
  const windowListeners = {};
  let fetchCount = 0;
  runInNewContext(code, {
    document: { querySelector: (selector) => selector === "#inquiry-form" ? form : status },
    window: { addEventListener: (name, handler) => { windowListeners[name] = handler; } },
    clearTimeout: () => { timeout = undefined; },
    setTimeout: (handler, delay) => { assert.equal(delay, 7000); timeout = handler; return 1; },
    showServiceNotice: () => false,
    serviceNotices: {},
    syncInquiryFields: () => {},
    FormData: class { entries() { return [["name", "Synthetic Guest"]]; } },
    fetch: async () => ({ ok: await responses[fetchCount++], status: 503 }),
    globalThis: { crypto: { randomUUID: () => "synthetic-submission-id" } },
  });
  const submitForm = () => submitHandler({ preventDefault() {} });
  return {
    classes,
    status,
    submit,
    submissionId,
    submitForm,
    windowListeners,
    dismiss: () => timeout?.(),
    get fetchCount() { return fetchCount; },
    get resetCount() { return resetCount; },
  };
}

test("untouched inquiry status is empty and configured as one polite announcement", () => {
  const html = read("inquiry.html");
  const region = html.match(/<div class="toast"[^>]*id="form-status"[^>]*>[\s\S]*?<\/div>/)?.[0];
  assert.ok(region);
  assert.match(region, /role="status"/);
  assert.match(region, /aria-live="polite"/);
  assert.match(region, /aria-atomic="true"/);
  assert.match(region, />\s*<\/div>/);
  assert.doesNotMatch(region, /received|could not send/i);
});

test("synthetic failure and retry announce only their actual results", async () => {
  const f = fixture([false, true]);
  assert.equal(f.status.textContent, "");

  await f.submitForm();
  assert.match(f.status.textContent, /could not send your inquiry/i);
  assert.equal(f.classes.has("error"), true);
  assert.equal(f.resetCount, 0);

  const retry = f.submitForm();
  assert.equal(f.status.textContent, "", "a new attempt clears the stale failure");
  await retry;
  assert.match(f.status.textContent, /inquiry has been received/i);
  assert.equal(f.classes.has("error"), false);
  assert.equal(f.resetCount, 1);
  assert.equal(f.fetchCount, 2);
});

test("dismissal and navigation remove stale announcements", async () => {
  const f = fixture([true, false]);
  await f.submitForm();
  f.dismiss();
  assert.equal(f.status.textContent, "");
  assert.equal(f.classes.has("show"), false);

  await f.submitForm();
  assert.match(f.status.textContent, /could not send/i);
  f.windowListeners.pagehide();
  assert.equal(f.status.textContent, "");
  assert.equal(f.classes.has("error"), false);
  assert.equal(f.classes.has("show"), false);
});

test("a repeated submit while a request is pending is ignored", async () => {
  let release;
  const pending = new Promise((resolve) => { release = () => resolve(true); });
  const source = read("script.js");
  assert.match(source, /if \(submit\.disabled\) return;/);
  const f = fixture([pending]);
  const first = f.submitForm();
  const second = f.submitForm();
  assert.equal(f.fetchCount, 1);
  release();
  await Promise.all([first, second]);
});
