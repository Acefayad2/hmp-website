import test from "node:test";
import assert from "node:assert/strict";
import { proposalEventType } from "../src/proposal-event-type.js";

test("lowercase inquiry event types are capitalized for the proposal editor", () => {
  assert.equal(proposalEventType("traditional marriage"), "Traditional Marriage");
  assert.equal(proposalEventType("baby shower"), "Baby Shower");
  assert.equal(proposalEventType("VIP Gala"), "VIP Gala");
  assert.equal(proposalEventType(""), "");
});
