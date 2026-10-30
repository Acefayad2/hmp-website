import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeAdminMessage } from "../netlify/functions/hmp-messages.mts";
import { normalizeProposal, parseProposal, serializeProposal, renderProposalCard } from "../proposal-ui.js";
import { validTotalServiceHours } from "../netlify/functions/hmp-inquiry.mts";

const proposal = { clientName: "Sample Client", serviceFee: 900, serviceHours: "N/A", associates: 0, machines: 0 };

test("N/A hours survive normalization, serialization, server sending and client parsing", () => {
  for (const hours of ["N/A", "n/a", "NA", " n/a "]) {
    assert.equal(normalizeProposal({ ...proposal, serviceHours: hours }).serviceHours, "N/A");
    assert.equal(parseProposal(normalizeAdminMessage(serializeProposal({ ...proposal, serviceHours: hours }))).serviceHours, "N/A");
  }
  for (const hours of [0, 4, 4.5, 240]) {
    assert.equal(parseProposal(normalizeAdminMessage(serializeProposal({ ...proposal, serviceHours: hours }))).serviceHours, hours);
  }
});

test("blank and zero equipment stays hidden; positive quantities render on client and print cards", () => {
  const original = globalThis.document;
  const createElement = () => ({ children: [], textContent: "", append(...children) { this.children.push(...children); } });
  globalThis.document = { createElement };
  const allText = node => [node.textContent, ...node.children.map(allText)].join(" ");
  try {
    for (const quantity of ["", 0, "0", undefined]) {
      const sent = parseProposal(normalizeAdminMessage(serializeProposal({ ...proposal, associates: quantity, machines: quantity })));
      const card = allText(renderProposalCard(sent, { showActions: false }));
      assert.match(card, /Service hours N\/A/);
      assert.doesNotMatch(card, /Money Associate|counting machine/);
    }
    const card = allText(renderProposalCard({ ...proposal, serviceHours: 4, associates: 2, machines: 1 }, { showActions: false }));
    assert.match(card, /2 Money Associates/);
    assert.match(card, /1 Money Counting Machine/);
    assert.match(card, /Service hours 4/);
  } finally { globalThis.document = original; }
});

test("hours input accepts N/A and half-hours and rejects invalid ranges and increments", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const pattern = html.match(/id="proposal-service-hours"[^>]*pattern="([^"]+)"/)?.[1];
  assert.ok(pattern);
  const accepted = new RegExp(`^(?:${pattern})$`, "v");
  for (const value of ["N/A", "n/a", "NA", "0", "4", "4.5", "240", "240.0"]) assert.ok(accepted.test(value), value);
  for (const value of ["four", "4.25", "240.5", "241", "-1", "1e2"]) assert.ok(!accepted.test(value), value);
});

test("optional Service Time Frame persists and only renders when supplied", () => {
  const original = globalThis.document;
  const createElement = () => ({ children: [], textContent: "", append(...children) { this.children.push(...children); } });
  globalThis.document = { createElement };
  const allText = node => [node.textContent, ...node.children.map(allText)].join(" ");
  try {
    const sent = parseProposal(normalizeAdminMessage(serializeProposal({ ...proposal, serviceTimeFrame: "6:30 PM–10:30 PM" })));
    assert.equal(sent.serviceTimeFrame, "6:30 PM–10:30 PM");
    assert.match(allText(renderProposalCard(sent, { showActions: false })), /Service Time Frame 6:30 PM–10:30 PM/);
    assert.doesNotMatch(allText(renderProposalCard(proposal, { showActions: false })), /Service Time Frame/);
  } finally { globalThis.document = original; }
});

test("required total service hours accepts only bounded half-hour increments", () => {
  for (const value of ["0.5", "4", "4.5", "240"]) assert.equal(validTotalServiceHours(value), true, value);
  for (const value of ["", "0", "4.25", "240.5", "hours", null]) assert.equal(validTotalServiceHours(value), false, String(value));
});
