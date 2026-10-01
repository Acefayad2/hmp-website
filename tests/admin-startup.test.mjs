import test from "node:test";
import assert from "node:assert/strict";
import { loadAdminWorkspace } from "../src/admin-startup.mjs";

test("shared seating sign-in failure does not prevent authenticated CRM data loading", async () => {
  const loaded = [];
  const result = await loadAdminWorkspace({
    syncSharedSession: async () => { throw new Error("SSO unavailable"); },
    loadDashboard: async () => { loaded.push("dashboard"); },
    loadMessages: async () => { loaded.push("messages"); },
  });
  assert.deepEqual(loaded.sort(), ["dashboard", "messages"]);
  assert.equal(result.sharedSessionReady, false);
});

test("CRM authentication and data failures still surface instead of looking successful", async () => {
  await assert.rejects(() => loadAdminWorkspace({
    syncSharedSession: async () => {},
    loadDashboard: async () => { throw new Error("Unauthorized"); },
    loadMessages: async () => {},
  }), /Unauthorized/);
  assert.equal((await loadAdminWorkspace({ syncSharedSession: async () => {}, loadDashboard: async () => {}, loadMessages: async () => {} })).sharedSessionReady, true);
});
