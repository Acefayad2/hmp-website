import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCalendarUrl, appendLinkedText } from "../calendar-link.js";
import { parseProposal, serializeProposal, renderProposalCard, PROPOSAL_PREFIX } from "../proposal-ui.js";
import { normalizeAdminMessage } from "../netlify/functions/hmp-messages.mts";

test("proposal booking links survive server normalization and render in client and print cards", () => {
  const calendarUrl = "https://calendar.app.google/CJn7HCVgHaqHM2fK6";
  const sent = parseProposal(normalizeAdminMessage(serializeProposal({ clientName: "Test Client", serviceFee: 900, calendarUrl })));
  assert.equal(sent.calendarUrl, calendarUrl);
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tag => ({ tag, children: [], append(...children) { this.children.push(...children); }, addEventListener() {} }) };
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  try {
    for (const showActions of [true, false]) {
      const links = descendants(renderProposalCard(sent, { showActions })).filter(node => node.tag === "a");
      assert.equal(links.length, 1);
      assert.equal(links[0].href, calendarUrl);
      assert.equal(links[0].textContent, "Open calendar link");
      assert.equal(links[0].rel, "noopener noreferrer");
      assert.equal(links[0].target, "_blank");
    }
  } finally { globalThis.document = previousDocument; }
});

test("server rejects unsafe calendar links even when frontend validation is bypassed", () => {
  for (const calendarUrl of [undefined, "", "javascript:alert(1)", "http://calendar.example", "https://user:pass@calendar.example", "not a link", { href: "https://calendar.example" }]) {
    const raw = `${PROPOSAL_PREFIX}${JSON.stringify({ clientName: "Test Client", serviceFee: 900, calendarUrl })}`;
    assert.equal(JSON.parse(normalizeAdminMessage(raw).slice(PROPOSAL_PREFIX.length)).calendarUrl, "");
  }
});

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
