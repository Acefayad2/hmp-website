import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const page = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replace(/\s+/g, " ")

test("September screenshot wording is present across the public pages", () => {
  for (const [file, phrases] of Object.entries({
    "index.html": ["complement every occasion", "Corporate Gatherings", "and More", "your occasion unfolds", "Enjoy the occasion", "Tell us about your occasion"],
    "about.html": ["through the occasion", "An exceptional occasion", "Every detail is thoughtfully curated", "occasion style—whether it’s a celebration or corporate gathering", "welcomes guests with ease"],
    "services.html": ["Occasion support", "Personalized to each occasion", "quote around your occasion", "occasion style", "fits your occasion"],
    "guest-seating.html": ["More enjoyment", "occasion itself", "occasion’s aesthetic", "Your occasion visuals"],
    "inquiry.html": ["Your occasion starts here", "Share your event details", ">Event type", "First Event Date", "Second Event Date", "First event location", "Second event vendor exit time"],
  })) for (const phrase of phrases) assert.ok(page(file).includes(phrase), `${file}: ${phrase}`)
})

test("visible field labels change without breaking inquiry submission keys", () => {
  assert.ok(page("inquiry.html").includes('name="celebration-type"'))
  assert.ok(page("inquiry.html").includes('name="celebration-date"'))
  for (const file of ["brand.css", "mobile.css"]) {
    assert.ok(page(file).includes("EVENT BRIEF"))
    assert.ok(!page(file).includes("CELEBRATION BRIEF"))
  }
})
