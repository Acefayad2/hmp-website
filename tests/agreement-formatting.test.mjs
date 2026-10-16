import test from "node:test";
import assert from "node:assert/strict";
import { formattedPageHTML, replaceFormattedPage, validatePageFormatting } from "../agreement-formatting.mjs";
import { editableSnapshot, issuedSnapshot, snapshotFor } from "../netlify/functions/_agreement-forms.mts";
import { termsHTML } from "../agreement-ui.mjs";

test("agreement formatting escapes all text and only renders supported marks/alignment", () => {
  const text = '<img src=x onerror=alert(1)>\nHello';
  const runs = [{start:0,end:text.length,bold:true,italic:true,underline:true,align:"center",onclick:"alert(1)"}];
  const html = formattedPageHTML(text,runs);
  assert.match(html, /agreement-align-center/);
  assert.match(html, /<strong><em><u>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|onclick=/);
  assert.equal(validatePageFormatting(text,runs)[0].onclick,undefined);
  assert.throws(() => validatePageFormatting(text,[{start:0,end:999}]),/no longer matches/);
  assert.throws(() => validatePageFormatting(text,[{start:2,end:3},{start:0,end:1}]),/no longer matches/);
  assert.throws(() => validatePageFormatting(text,{}),/Too much/);
});

test("draft formatting survives save/reopen without mutating the template or legacy snapshots", () => {
  const snapshot = snapshotFor("guest-seating"), original = structuredClone(snapshot);
  const pages = [...snapshot.pages]; pages[0] = "  Hello\nWorld  ";
  const pageFormatting = pages.map((page,i) => i ? [] : [{start:2,end:7,bold:true,align:"center"}]);
  const saved = editableSnapshot(snapshot,{pages,pageFormatting});
  assert.equal(saved.pages[0],pages[0]);
  assert.deepEqual(saved.pageFormatting,pageFormatting);
  assert.deepEqual(editableSnapshot(saved,{title:"New title"}).pageFormatting,pageFormatting);
  assert.match(termsHTML(saved), /<strong>Hello<\/strong>/);
  assert.equal(editableSnapshot(saved,{pages}).pageFormatting,undefined,"Plain-text older clients must not retain stale formatting");
  assert.equal(editableSnapshot(snapshot,{}).pageFormatting,undefined);
  assert.deepEqual(snapshot,original);
  assert.throws(() => editableSnapshot(snapshot,{pageFormatting:[]}),/match every page/);
});

test("issuing formatted Money Table terms preserves marks through placeholder replacement", () => {
  const snapshot = snapshotFor("money-collecting-changing");
  const page = "Hours: {{serviceHours}}\nDone";
  const formatted = {...snapshot,pages:[page],pageFormatting:[[{start:7,end:page.indexOf("\n"),bold:true},{start:page.indexOf("Done"),end:page.length,underline:true,align:"right"}]]};
  const issued = issuedSnapshot(formatted,{serviceHours:"4.5"});
  assert.equal(issued.pages[0],"Hours: 4.5\nDone");
  assert.match(termsHTML(issued),/<strong>4.5<\/strong>/);
  assert.match(termsHTML(issued),/agreement-align-right"><u>Done<\/u>/);
  assert.equal(formatted.pages[0],page);
});

test("deleted optional clauses, split placeholders, and adjacent replacements remain valid", () => {
  const text = "{{foo}}{{bar}} end";
  const result = replaceFormattedPage(text,[{start:0,end:3,bold:true},{start:3,end:7,italic:true},{start:7,end:text.length,underline:true}], key => key === "foo" ? "" : "New");
  assert.equal(result.text,"New end");
  assert.doesNotThrow(() => formattedPageHTML(result.text,result.formatting));
  assert.equal(formattedPageHTML("\n",[]),'<div class="agreement-align-left"><br></div><div class="agreement-align-left"><br></div>');
});
