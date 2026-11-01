import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {clientAccessNotice} from "../client-hub.js";

test("all hub creation paths use the shared database expiration rule, not a one-year default",()=>{
  for (const file of ["hmp-inquiry","hmp-dashboard","hmp-sms","hmp-messages","_document-messages"]) {
    const source=readFileSync(new URL(`../netlify/functions/${file}.mts`,import.meta.url),"utf8");
    assert.doesNotMatch(source,/365\s*\*/);
  }
});
test("Admin distinguishes automatic, custom and preserved legacy expiry without implying deletion",()=>{
  const thread={active:true,expiresAt:"2026-11-02T04:59:59.999Z"};
  assert.match(clientAccessNotice({...thread,expirationMode:"event"},0),/Automatic: 7 days after the last event/);
  assert.match(clientAccessNotice({...thread,expirationMode:"custom"},0),/Custom date chosen by Admin/);
  assert.match(clientAccessNotice({...thread,expirationMode:"legacy"},0),/Existing saved date preserved/);
  assert.match(clientAccessNotice({...thread,expirationMode:"event"},Date.parse(thread.expiresAt)),/Client access expired/);
});
