import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const page = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replace(/\s+/g, " ")

test("September screenshot wording is present across the public pages", () => {
  for (const [file, phrases] of Object.entries({
    "index.html": ["complement every event", "Corporate Gatherings", "and More", "your event unfolds", "Enjoy the event", "Tell us about your event"],
    "about.html": ["through the event", "An exceptional event", "Every detail is thoughtfully curated", "event style—from private parties to corporate gatherings", "welcomes guests with ease"],
    "services.html": ["Event support", "Personalized to each event", "quote around your event", "event style", "fits your event"],
    "guest-seating.html": ["More enjoyment", "event itself", "event’s aesthetic", "Your event visuals"],
    "inquiry.html": ["Your event starts here", "Share your event details", ">Event type", "First Event Date", "Second Event Date", "First event location", "Second event vendor exit time"],
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
