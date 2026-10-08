import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")

test("the intro uses the existing plum background with a cream accent", () => {
  const css = read("brand.css")
  const shell = css.match(/\.show-brand-intro \.brand-intro\s*\{([^}]+)\}/)[1]
  const line = css.match(/\.brand-intro__line\s*\{([^}]+)\}/)[1]
  assert.match(css, /--plum:\s*#604545;/)
  assert.match(shell, /background:\s*var\(--plum\);/)
  assert.doesNotMatch(shell, /var\(--paper\)|radial-gradient/)
  assert.match(line, /background:\s*var\(--cream\);/)
  assert.match(read("index.html"), /brand\.css\?v=20261008-intro-line/)
})

test("the intro accent stays below the logo wording on desktop and mobile", () => {
  const css = read("brand.css")
  assert.match(css, /\.brand-intro__line\s*\{[^}]*bottom:\s*4%;/)
  assert.match(css, /@media \(max-width: 800px\)\s*\{[\s\S]*?\.brand-intro__line\s*\{\s*bottom:\s*10%;/)
})

test("the intro retains its full-screen placement and responsive logo sizing", () => {
  const css = read("brand.css")
  const shell = css.match(/\.show-brand-intro \.brand-intro\s*\{([^}]+)\}/)[1]
  assert.match(shell, /position:\s*fixed;/)
  assert.match(shell, /inset:\s*0;/)
  assert.match(shell, /place-items:\s*center;/)
  assert.match(css, /width:\s*min\(440px, 78vw\);/)
  assert.match(css, /width:\s*min\(340px, 84vw\);/)
  assert.match(css, /height:\s*auto;\s*object-fit:\s*contain;/)
})

test("the intro remains once per session and respects reduced motion", () => {
  const setup = read("index.html").match(/<script>\s*([\s\S]*?)<\/script>/)[1]
  for (const [reduceMotion, seen, expected] of [[false, null, true], [false, "true", false], [true, null, false]]) {
    const classes = new Set()
    let stored = seen
    runInNewContext(setup, {
      document: { documentElement: { classList: { add: (name) => classes.add(name) } } },
      window: {
        matchMedia: () => ({ matches: reduceMotion }),
        sessionStorage: { getItem: () => stored, setItem: (_, value) => { stored = value } },
      },
    })
    assert.equal(classes.has("show-brand-intro"), expected)
    assert.equal(stored, expected ? "true" : seen)
  }
  assert.match(read("brand.css"), /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.brand-intro\s*\{\s*display: none !important;/)
})

test("click, shell animation and fallback timer dismiss the intro only once", () => {
  const source = read("script.js").split('const menuButton =')[0]
  for (const trigger of ["click", "animationend", "timeout"]) {
    const classes = new Set(["show-brand-intro"])
    const listeners = {}
    let removed = 0
    let timeout
    const intro = { addEventListener: (name, callback) => { listeners[name] = callback }, remove: () => { removed += 1 } }
    runInNewContext(source, {
      document: {
        querySelector: () => intro,
        documentElement: { classList: { contains: (name) => classes.has(name), remove: (name) => classes.delete(name) } },
      },
      window: { setTimeout: (callback, delay) => { timeout = callback; assert.equal(delay, 3000) } },
    })
    listeners.animationend({ target: {} })
    assert.equal(removed, 0, "child animations must not dismiss the intro")
    if (trigger === "timeout") timeout()
    else listeners[trigger]({ target: intro })
    assert.equal(classes.has("show-brand-intro"), false)
    listeners.click()
    timeout()
    assert.equal(removed, 1, "repeated dismissal must be harmless")
  }
})

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
