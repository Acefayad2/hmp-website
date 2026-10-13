import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeAdminMessage } from "../netlify/functions/hmp-messages.mts";
import { normalizeProposal, parseProposal, serializeProposal } from "../proposal-ui.js";

const proposal = { clientName: "Sample Client", serviceFee: 900, serviceHours: "N/A", associates: 0, machines: 0 };

test("N/A service hours survive drafts, sending, and client proposal parsing", () => {
  assert.equal(normalizeProposal(proposal).serviceHours, "N/A");
  assert.equal(parseProposal(serializeProposal(proposal)).serviceHours, "N/A");
  const sent = normalizeAdminMessage(serializeProposal(proposal));
  assert.equal(parseProposal(sent).serviceHours, "N/A");
  assert.equal(parseProposal(normalizeAdminMessage(serializeProposal({ ...proposal, serviceHours: 4 }))).serviceHours, 4);
});

test("zero money-associate and machine quantities remain zero and render no service lines", () => {
  const sent = parseProposal(normalizeAdminMessage(serializeProposal(proposal)));
  assert.equal(sent.associates, 0);
  assert.equal(sent.machines, 0);
  const renderer = readFileSync(new URL("../proposal-ui.js", import.meta.url), "utf8");
  assert.match(renderer, /\.\.\.\(value\.associates \? \[/);
  assert.match(renderer, /\.\.\.\(value\.machines \? \[/);
});

test("service-hours entry accepts N/A and valid half-hours but rejects out-of-range values", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const pattern = html.match(/id="proposal-service-hours"[^>]*pattern="([^"]+)"/)?.[1];
  assert.ok(pattern);
  const accepted = new RegExp(`^(?:${pattern})$`, "v");
  for (const value of ["N/A", "n/a", "4", "4.5", "240", "240.0"]) assert.ok(accepted.test(value), value);
  for (const value of ["four", "4.25", "240.5", "241", "-1"]) assert.ok(!accepted.test(value), value);
});
