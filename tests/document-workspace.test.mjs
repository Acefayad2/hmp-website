import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
const config = source.slice(source.indexOf("const workspaceViews ="), source.indexOf("const escapeHTML ="));
const navigation = source.slice(source.indexOf("const setWorkspaceView ="), source.indexOf("const showPasswordForm ="));
const element = (dataset = {}) => ({
  dataset, hidden: false, attributes: {},
  classList: { toggle() {} },
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
});

test("invoices and contracts share one sidebar selection while preserving their routes and loaders", () => {
  const nodes = new Map();
  const tabs = [element({ documentView: "invoices" }), element({ documentView: "contracts" })];
  const links = [element({ workspaceView: "invoices", workspaceGroup: "documents" }), element({ workspaceView: "messages" })];
  const calls = [];
  const paths = [];
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const context = {
    $, document: { querySelectorAll: (selector) => selector === "[data-document-view]" ? tabs : links },
    history: { pushState: (_, __, path) => paths.push(path) },
    ...Object.fromEntries(["Invoices", "Contracts", "Messages", "Reviews"].map((name) => [
      `load${name}`, () => { calls.push(name); return Promise.resolve(); },
    ])),
  };
  const navigate = runInNewContext(`let activeWorkspaceView; ${config}\n${navigation}\nsetWorkspaceView`, context);
  for (const view of ["invoices", "contracts"]) {
    navigate(view, true);
    assert.equal($(".dashboard-header h1").textContent, "Invoices & Contracts");
    assert.equal($("#document-tabs").hidden, false);
    assert.equal($("#invoice-workspace").hidden, view !== "invoices");
    assert.equal($("#contract-workspace").hidden, view !== "contracts");
    assert.equal(links[0].attributes["aria-current"], "page");
    for (const tab of tabs) {
      assert.equal(tab.attributes["aria-selected"], String(tab.dataset.documentView === view));
      assert.equal(tab.tabIndex, tab.dataset.documentView === view ? 0 : -1);
    }
  }
  navigate("messages", true);
  assert.equal($("#document-tabs").hidden, true);
  assert.equal($("#invoice-workspace").hidden, true);
  assert.equal($("#contract-workspace").hidden, true);
  assert.equal(links[0].attributes["aria-current"], undefined);
  assert.deepEqual(calls, ["Invoices", "Contracts", "Messages"]);
  assert.deepEqual(paths, ["/admin?view=invoices", "/admin?view=contracts", "/admin?view=messages"]);
});

test("sidebar has one document entry and both accessible tab panels remain available", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  assert.equal((html.match(/data-workspace-group="documents"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="rail-link"[^>]*data-workspace-view="contracts"/);
  assert.match(html, /id="document-tabs" role="tablist"/);
  assert.match(html, /id="invoice-workspace" role="tabpanel" aria-labelledby="invoices-tab"/);
  assert.match(html, /id="contract-workspace" role="tabpanel" aria-labelledby="contracts-tab"/);
});
