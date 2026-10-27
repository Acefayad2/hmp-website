import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_AUTH_REQUIRED_EVENT, agreementRequest, createAdminFormDialogSuspension } from "../agreement-ui.mjs";
import { createAdminAuthRecovery } from "../src/admin-auth-recovery.js";

test("expired Admin proof interrupts Forms list, save, and share without replaying a write", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const browser = new EventTarget();
  let required = 0;
  browser.addEventListener(ADMIN_AUTH_REQUIRED_EVENT, () => { required++; });
  globalThis.window = browser;
  const calls = [];
  globalThis.fetch = async (path, options = {}) => {
    calls.push({path, method:options.method || "GET", body:options.body});
    return Response.json({error:"Unauthorized"}, {status:401});
  };
  try {
    for (const [label, options] of [
      ["list", {}],
      ["save", {method:"POST", body:JSON.stringify({clientName:"Typed Client"})}],
      ["share", {method:"PATCH", body:JSON.stringify({action:"share"})}],
    ]) {
      await assert.rejects(
        agreementRequest("/api/hmp-agreement-forms", options),
        error => error.status === 401 && /Verify your sign-in, then try again/.test(error.message),
        label,
      );
    }
    assert.deepEqual(calls.map(call => call.method), ["GET", "POST", "PATCH"]);
    assert.equal(calls.filter(call => call.method !== "GET").length, 2, "each requested mutation runs exactly once");
    assert.equal(required, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("a private client-link 401 remains a client error and never opens Admin verification", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const browser = new EventTarget();
  let required = 0;
  browser.addEventListener(ADMIN_AUTH_REQUIRED_EVENT, () => { required++; });
  globalThis.window = browser;
  globalThis.fetch = async () => Response.json({error:"This private link is invalid."}, {status:401});
  try {
    await assert.rejects(agreementRequest("/api/hmp-agreement"), error => error.status === 401 && error.message === "This private link is invalid.");
    assert.equal(required, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("concurrent 401 notices start one verification recovery and do not retry requests", async () => {
  let getUserCalls = 0, verificationCalls = 0, loginCalls = 0, starts = 0;
  let finishVerification;
  const verification = new Promise(resolve => { finishVerification = resolve; });
  const recover = createAdminAuthRecovery({
    getUser:async () => { getUserCalls++; return {email:"admin@example.test"}; },
    ensureVerification:async () => { verificationCalls++; await verification; return false; },
    showLogin:() => { loginCalls++; return false; },
    onStart:() => { starts++; },
  });
  const first = recover(), second = recover(), third = recover();
  await Promise.resolve();
  assert.equal(first, second);
  assert.equal(second, third);
  finishVerification();
  await Promise.all([first, second, third]);
  assert.deepEqual({getUserCalls, verificationCalls, loginCalls, starts}, {getUserCalls:1, verificationCalls:1, loginCalls:0, starts:1});
});

test("missing Identity session shows the existing login without attempting code verification", async () => {
  let verified = 0, shown = 0;
  const recover = createAdminAuthRecovery({
    getUser:async () => null,
    ensureVerification:async () => { verified++; },
    showLogin:() => { shown++; return false; },
  });
  assert.equal(await recover(), false);
  assert.equal(verified, 0);
  assert.equal(shown, 1);
});

test("Forms dialogs suspend once and restore the same typed DOM after verification", () => {
  const calls = [];
  const formDialog = {open:true,isConnected:true,typedValue:"Typed Client",close(){calls.push("close");this.open=false;},showModal(){calls.push("show");this.open=true;}};
  const agreementDialog = {open:false,isConnected:true,close(){throw new Error("closed dialog must not close again");},showModal(){throw new Error("unsuspended dialog must not open");}};
  const suspension = createAdminFormDialogSuspension({querySelectorAll:() => [formDialog,agreementDialog]});
  suspension.suspend();
  suspension.suspend();
  assert.equal(formDialog.open,false);
  assert.equal(formDialog.typedValue,"Typed Client");
  suspension.restore();
  assert.equal(formDialog.open,true);
  assert.equal(formDialog.typedValue,"Typed Client");
  assert.deepEqual(calls,["close","show"]);
});
