import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installPageSearch, matchesSearch, searchText } from "../page-search.js";

test("search ignores case, accents and whitespace, and matches terms across fields literally", () => {
  const text = searchText("José Smith", "jose@example.test", ["Wedding", ["INV-104", 1250]], null, { token: "secret" });
  assert.ok(matchesSearch(text, "  JOSE   wedding  "));
  assert.ok(matchesSearch(text, "1250 inv-104"));
  assert.ok(matchesSearch(text, " \n "));
  assert.ok(!matchesSearch(text, "unrelated"));
  assert.ok(!matchesSearch(text, "secret"));
  assert.ok(matchesSearch("<script> is just text", "<script>"));
  assert.ok(!matchesSearch(text, ".*"));
});

function harness() {
  const observers = [];
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.attrs = {}; this.events = {}; this.value = ""; this.textContent = ""; }
    setAttribute(key, value) { this.attrs[key] = value; }
    append(...nodes) { this.children.push(...nodes); }
    prepend(node) { this.children.unshift(node); }
    addEventListener(name, callback) { this.events[name] = callback; }
    querySelectorAll() { return this.records; }
    focus() { this.focused = true; }
  }
  globalThis.document = { createElement: () => new Element() };
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(container, options) { this.options = options; }
    disconnect() { this.disconnected = true; }
  };
  const root = new Element();
  const first = new Element(), second = new Element();
  first.textContent = "Alice Wedding"; first.dataset.searchText = "alice@example.test special-menu.pdf";
  second.textContent = "Bob Birthday";
  root.records = [first, second];
  const search = installPageSearch({ root, id: "test-search", label: "Search records", placeholder: "Name…", items: ".row", containers: [{ id: "list" }] });
  const [label, row, status] = root.children[0].children;
  return { root, first, second, search, clear: row.children[1], status, label, observer: observers[0] };
}

test("page search filters supplemental fields, explains no matches, clears and preserves records", () => {
  const h = harness();
  h.search.input.value = "special-menu"; h.search.input.events.input();
  assert.equal(h.first.dataset.searchHidden, "false");
  assert.equal(h.second.dataset.searchHidden, "true");
  assert.equal(h.status.textContent, "1 of 2 items match.");
  assert.equal(h.label.htmlFor, "test-search");
  assert.equal(h.search.input.attrs["aria-controls"], "list");
  h.search.input.value = "missing"; h.search.input.events.input();
  assert.match(h.status.textContent, /No matches on this page/);
  h.clear.events.click();
  assert.equal(h.first.dataset.searchHidden, "false");
  assert.equal(h.second.dataset.searchHidden, "false");
  assert.equal(h.search.input.focused, true);
  assert.equal(h.clear.disabled, true);
  assert.equal(h.root.records.length, 2, "Search must not remove or mutate saved records");
});

test("queries survive live row replacement and stay independent between sections", () => {
  const a = harness(), b = harness();
  a.search.input.value = "birthday"; a.search.apply();
  assert.equal(b.search.input.value, "");
  a.root.records = [{ textContent: "Carol Birthday", dataset: {} }];
  a.observer.callback();
  assert.equal(a.search.input.value, "birthday");
  assert.equal(a.root.records[0].dataset.searchHidden, "false");
  assert.deepEqual(a.observer.options.attributeFilter, ["data-search-text"], "Hidden-state writes must not trigger observer loops");
  a.search.input.events.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(a.search.input.value, "");
  a.search.disconnect(); assert.equal(a.observer.disconnected, true);
});

test("all Admin sections and the hub wire their search assets into the production build", () => {
  const config = readFileSync(new URL("../src/admin-search.js", import.meta.url), "utf8");
  for (const section of ["messages", "proposals", "forms", "invoice", "contract", "reviews"]) assert.ok(config.includes(`["${section}", "Search`));
  const admin = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  assert.match(admin, /Search inquiries/);
  const build = readFileSync(new URL("../scripts/build-admin.mjs", import.meta.url), "utf8");
  for (const file of ["page-search.js", "page-search.css", "dashboard-search.js"]) assert.ok(build.includes(`"${file}"`));
  const hub = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  assert.match(hub, /id="hub-search"/);
  assert.match(hub, /src="dashboard-search.js/);
});
