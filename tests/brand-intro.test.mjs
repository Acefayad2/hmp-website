import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("the intro uses the original logo without a second moon", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8")
  const css = readFileSync(new URL("../brand.css", import.meta.url), "utf8")
  const intro = html.slice(html.indexOf('<div class="brand-intro"'), html.indexOf('<a class="skip-link"'))
  assert.equal((intro.match(/<img\b/g) || []).length, 1)
  assert.ok(intro.includes('/assets/brand/hmp-logo-2026.png'))
  assert.ok(!intro.includes("brand-intro__moon"))
  assert.ok(!css.includes("hmp-intro-moon"))
  assert.ok(!css.includes(".brand-intro__moon"))
})
