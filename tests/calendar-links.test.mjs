import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCalendarUrl, appendLinkedText } from "../calendar-link.js";
import { parseProposal, serializeProposal } from "../proposal-ui.js";

test("calendar links are optional and only safe https URLs survive proposal serialization", () => {
  assert.equal(parseProposal(serializeProposal({ title: "Dinner" })).calendarUrl, "");
  assert.equal(parseProposal(serializeProposal({ calendarUrl: "https://calendar.example/meet?id=2" })).calendarUrl,
    "https://calendar.example/meet?id=2");
  for (const value of ["javascript:alert(1)", "http://calendar.example", "https://user:pass@calendar.example", "not a link"]) {
    assert.equal(normalizeCalendarUrl(value), "");
    assert.equal(parseProposal(serializeProposal({ calendarUrl: value })).calendarUrl, "");
  }
});

test("portal message links are text nodes and safe anchors, not injected HTML", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createTextNode: (text) => ({ type: "text", text }),
    createElement: (tag) => ({ type: tag }),
  };
  try {
    const element = { children: [], append(child) { this.children.push(child); } };
    appendLinkedText(element, 'Calendar: https://calendar.example/meet. <img src=x>');
    const link = element.children.find((child) => child.type === "a");
    assert.equal(link.href, "https://calendar.example/meet");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.target, "_blank");
    assert.equal(element.children.at(-2).text, '.');
    assert.equal(element.children.at(-1).text, ' <img src=x>');
  } finally {
    globalThis.document = previousDocument;
  }
});

test("HMP booking calendar can be shared as a safe clickable message link", () => {
  const bookingUrl = "https://calendar.app.google/CJn7HCVgHaqHM2fK6";
  assert.equal(normalizeCalendarUrl(bookingUrl), bookingUrl);
  const previousDocument = globalThis.document;
  globalThis.document = {
    createTextNode: (text) => ({ type: "text", text }),
    createElement: (tag) => ({ type: tag }),
  };
  try {
    const element = { children: [], append(child) { this.children.push(child); } };
    appendLinkedText(element, `Book an appointment: ${bookingUrl}`);
    const link = element.children.find((child) => child.type === "a");
    assert.equal(link.href, bookingUrl);
    assert.equal(link.textContent, bookingUrl);
    assert.equal(link.rel, "noopener noreferrer");
  } finally {
    globalThis.document = previousDocument;
  }
});
