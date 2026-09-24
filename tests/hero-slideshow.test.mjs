import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { runInNewContext } from "node:vm"

const source = readFileSync(new URL("../hero-slideshow.js", import.meta.url), "utf8")
function element() {
  const classes = new Set()
  return {
    attrs: {}, events: {}, hidden: true,
    classList: { add: name => classes.add(name), contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    setAttribute(name, value) { this.attrs[name] = value },
    addEventListener(name, listener) { this.events[name] = listener },
  }
}
function fixture(reduced = false) {
  const hero = element(), playback = element(), icon = element(), status = element(), controls = element()
  const images = Array.from({ length: 3 }, (_, i) => ({ alt: `Scene ${i}`, decode: async () => {} }))
  const frames = images.map(img => ({ ...element(), querySelector: () => img }))
  const buttons = images.map(() => element())
  hero.querySelectorAll = selector => selector === '[data-hero-frame]' ? frames : buttons
  hero.querySelector = selector => ({ '[data-hero-playback]': playback, '[data-hero-playback-icon]': icon, '[data-hero-status]': status, '[data-hero-controls]': controls })[selector]
  let timer, observer
  const motion = { matches: reduced, addEventListener: (_, cb) => { motion.change = cb } }
  const doc = { hidden: false, events: {}, querySelector: () => hero, addEventListener: (name, cb) => { doc.events[name] = cb } }
  const win = { matchMedia: () => motion, setTimeout: cb => { timer = cb; return 1 }, clearTimeout: () => { timer = undefined }, IntersectionObserver: true }
  runInNewContext(source, { document: doc, window: win, IntersectionObserver: class { constructor(cb) { observer = cb } observe() {} } })
  return { hero, playback, icon, status, controls, images, frames, buttons, motion, doc, tick: () => timer?.(), hasTimer: () => Boolean(timer), visibility: visible => observer([{ isIntersecting: visible }]) }
}

test("hero cycles scenes, manual choice pauses, and play resumes", async () => {
  const f = fixture()
  assert.equal(f.controls.hidden, false)
  await f.tick()
  assert.equal(f.buttons[1].attrs['aria-pressed'], 'true')
  await f.buttons[2].events.click()
  assert.equal(f.frames[2].attrs['aria-hidden'], 'false')
  assert.equal(f.frames[1].attrs['aria-hidden'], 'true')
  assert.equal(f.status.textContent, 'Scene 2')
  assert.equal(f.hasTimer(), false)
  assert.equal(f.playback.attrs['aria-label'], 'Play slideshow')
  f.playback.events.click()
  await f.tick()
  assert.equal(f.buttons[0].attrs['aria-pressed'], 'true')
})

test("reduced motion disables autoplay; offscreen and hidden pages suspend it", () => {
  const reduced = fixture(true)
  assert.equal(reduced.hasTimer(), false)
  const f = fixture()
  f.visibility(false)
  assert.equal(f.hasTimer(), false)
  f.visibility(true)
  assert.equal(f.hasTimer(), true)
  f.doc.hidden = true
  f.doc.events.visibilitychange()
  assert.equal(f.hasTimer(), false)
  f.doc.hidden = false
  f.doc.events.visibilitychange()
  assert.equal(f.hasTimer(), true)
  f.motion.matches = true
  f.motion.change()
  assert.equal(f.hasTimer(), false)
})

test("hover and keyboard interaction pause motion; failed images never replace a scene", async () => {
  const f = fixture()
  f.hero.events.pointerenter({ pointerType: 'mouse' })
  assert.equal(f.hasTimer(), false)
  f.hero.events.pointerleave()
  assert.equal(f.hasTimer(), true)
  f.hero.events.focusin({ target: f.buttons[0] })
  assert.equal(f.hasTimer(), false)
  f.images[1].decode = async () => { throw new Error('image unavailable') }
  await f.buttons[1].events.click()
  assert.equal(f.frames[1].classList.contains('is-active'), false)
  assert.equal(f.hasTimer(), false)
})

test("hero has three local images, an initial no-JS scene, and reduced-motion CSS", () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('<section class="celebrations-served"'))
  const assets = [...hero.matchAll(/src="(assets\/hero-[^"]+)"/g)].map(match => match[1])
  assert.equal(assets.length, 3)
  assets.forEach(asset => assert.ok(existsSync(new URL(`../${asset}`, import.meta.url))))
  assert.match(hero, /hero-frame is-active/)
  assert.match(hero, /Class of 2027/)
  assert.match(hero, /data-hero-controls hidden/)
  const css = readFileSync(new URL('../hero-slideshow.css', import.meta.url), 'utf8')
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /focus-visible/)
})
