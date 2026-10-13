import test from "node:test";
import assert from "node:assert/strict";
import { groupDocumentVersions } from "../src/document-versions.js";
import { groupProposalVersions } from "../src/proposals-workspace.js";
import { nextRevision } from "../netlify/functions/_document-revisions.mts";

test("document versions appear once per logical record, newest first", () => {
  const rows = [
    {id:"old", revisionGroupId:"old", revisionNumber:1, createdAt:"2026-01-01"},
    {id:"new", revisionGroupId:"old", revisionNumber:2, createdAt:"2026-01-02"},
    {id:"other", revisionGroupId:"other", revisionNumber:1, createdAt:"2026-01-03"},
  ];
  assert.deepEqual(groupDocumentVersions(rows).map(group => group.map(row => row.id)), [["other"],["new","old"]]);
});

test("proposal revisions share the first sent message's lineage", () => {
  const thread = {id:"thread"};
  const records = [
    {thread, message:{id:"first",createdAt:"2026-01-01"}, proposal:{version:1,lineageId:""}},
    {thread, message:{id:"second",createdAt:"2026-01-02"}, proposal:{version:2,lineageId:"first"}},
  ];
  assert.deepEqual(groupProposalVersions(records).map(group => group.map(row => row.message.id)), [["second","first"]]);
});

test("a restored old version gets a number above the current latest version", async () => {
  const db = {from:() => ({select(){return this;},eq(){return this;},order(){return this;},limit(){return Promise.resolve({data:[{revision_number:5}],error:null});}})};
  assert.deepEqual(await nextRevision(db,"documents",{id:"original",revision_number:1}), {groupId:"original",number:6});
});
