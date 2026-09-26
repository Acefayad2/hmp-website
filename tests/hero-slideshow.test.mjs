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
  const hero = element(), playback = element()
  const images = Array.from({ length: 3 }, (_, i) => ({ alt: `Scene ${i}`, decode: async () => {} }))
  const frames = images.map(img => ({ ...element(), querySelector: () => img }))
  hero.querySelectorAll = () => frames
  hero.contains = target => target === hero
  let timer, observer
  const motion = { matches: reduced, addEventListener: (_, cb) => { motion.change = cb } }
  const doc = { hidden: false, events: {}, querySelector: selector => selector === '[data-hero-slideshow]' ? hero : playback, addEventListener: (name, cb) => { doc.events[name] = cb } }
  const win = { matchMedia: () => motion, setTimeout: cb => { timer = cb; return 1 }, clearTimeout: () => { timer = undefined }, IntersectionObserver: true }
  runInNewContext(source, { document: doc, window: win, IntersectionObserver: class { constructor(cb) { observer = cb } observe() {} } })
  return { hero, playback, images, frames, motion, doc, tick: () => timer?.(), hasTimer: () => Boolean(timer), visibility: visible => observer([{ isIntersecting: visible }]) }
}

test("hero cycles all scenes and footer playback pauses and resumes", async () => {
  const f = fixture()
  assert.equal(f.playback.hidden, false)
  await f.tick()
  assert.equal(f.frames[1].attrs['aria-hidden'], 'false')
  await f.tick()
  assert.equal(f.frames[2].attrs['aria-hidden'], 'false')
  assert.equal(f.frames[1].attrs['aria-hidden'], 'true')
  f.playback.events.click()
  assert.equal(f.hasTimer(), false)
  assert.equal(f.playback.textContent, 'Play homepage slideshow')
  f.playback.events.click()
  await f.tick()
  assert.equal(f.frames[0].attrs['aria-hidden'], 'false')
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

test("mouse hovering over the hero does not stop automatic playback", async () => {
  const f = fixture()
  f.hero.events.pointerenter?.({ pointerType: 'mouse' })
  assert.equal(f.hasTimer(), true)
  await f.tick()
  assert.equal(f.frames[1].attrs['aria-hidden'], 'false')
})

test("focus temporarily suspends playback without undoing an explicit pause", () => {
  const f = fixture()
  f.hero.events.focusin()
  assert.equal(f.hasTimer(), false)
  f.hero.events.focusout({ relatedTarget: f.hero })
  assert.equal(f.hasTimer(), false)
  f.hero.events.focusout({ relatedTarget: null })
  assert.equal(f.hasTimer(), true)
  f.playback.events.click()
  f.hero.events.focusin()
  f.hero.events.focusout({ relatedTarget: null })
  assert.equal(f.hasTimer(), false)
})

test("failed images never replace the current scene", async () => {
  const f = fixture()
  f.images[1].decode = async () => { throw new Error('image unavailable') }
  await f.tick()
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
  assert.doesNotMatch(hero, /data-hero-controls|data-hero-select|data-hero-playback/)
  assert.match(html.slice(html.indexOf('<footer>')), /data-hero-playback hidden/)
  const css = readFileSync(new URL('../hero-slideshow.css', import.meta.url), 'utf8')
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /focus-visible/)
})

test("a slow image cannot finish an automatic transition after pause or leaving the hero", async () => {
  for (const stop of [f => f.playback.events.click(), f => f.hero.events.focusin(), f => f.visibility(false), f => { f.doc.hidden = true; f.doc.events.visibilitychange() }]) {
    const f = fixture()
    let finish
    f.images[1].decode = () => new Promise(resolve => { finish = resolve })
    const pending = f.tick()
    stop(f)
    finish()
    await pending
    assert.equal(f.frames[1].classList.contains('is-active'), false)
    assert.equal(f.hasTimer(), false)
  }
})

test("services uses the baby-shower check-in image and ships it in the build", () => {
  const services = readFileSync(new URL('../services.html', import.meta.url), 'utf8')
  const build = readFileSync(new URL('../scripts/build-admin.mjs', import.meta.url), 'utf8')
  const asset = 'assets/guest-check-in-baby-shower.webp'
  assert.ok(services.includes(`src="${asset}"`))
  assert.ok(build.includes(`"${asset}"`))
  assert.ok(existsSync(new URL(`../${asset}`, import.meta.url)))
})
