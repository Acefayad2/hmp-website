import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("admin sidebar follows the requested order and preserves tab destinations", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const sidebar = html.match(/<aside class="dashboard-rail">([\s\S]*?)<\/aside>/)[1];
  const links = [...sidebar.matchAll(/<a class="rail-link[^\"]*" href="([^\"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map(([, href, label]) => ({ href, label: label.replaceAll("&amp;", "&") }));
  assert.deepEqual(links, [
    { href: "/dashboard", label: "Dashboard hub" },
    { href: "/admin", label: "Inquiries" },
    { href: "/admin?view=messages", label: "Messages" },
    { href: "/admin?view=proposals", label: "Proposals" },
    { href: "/admin?view=forms", label: "Forms" },
    { href: "/admin?view=invoices", label: "Invoices & Contracts" },
    { href: "/admin?view=reviews", label: "Reviews" },
    { href: "/", label: "View website" },
  ]);
});
