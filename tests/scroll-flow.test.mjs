import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("page sections stay visible without scroll-triggered entrances", () => {
  const script = readFileSync(new URL("../script.js", import.meta.url), "utf8")
  const css = readFileSync(new URL("../mobile.css", import.meta.url), "utf8")
  assert.ok(!script.includes("revealObserver"))
  assert.ok(!script.includes('classList.add("scroll-reveal")'))
  const fallback = css.match(/\.scroll-reveal\.is-visible\s*\{([^}]+)\}/)?.[1]
  assert.ok(fallback, "cached-script compatibility rule is present")
  assert.match(fallback, /opacity:\s*1;/)
  assert.match(fallback, /transform:\s*none;/)
  assert.match(fallback, /transition:\s*none;/)
  assert.ok(script.includes("syncReviewsMarquee"), "review movement stays intact")
  assert.ok(script.includes("backToTopObserver"), "back-to-top still tracks scroll position")
})
