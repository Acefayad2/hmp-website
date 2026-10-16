import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderDocumentCard, printDocumentCopy } from "../document-message-ui.js";
import { renderProposalMessage, renderProposalCard } from "../proposal-ui.js";

const descendants = node => [node, ...node.children.flatMap(descendants)];
const content = node => descendants(node).map(item => item.textContent || "").join("\n");
function withDOM(run) {
  const previous = { document:globalThis.document, window:globalThis.window, location:globalThis.location };
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  globalThis.document = {createElement:tag => ({
    tag, children:[], events:{}, textContent:"", append(...children) {this.children.push(...children);},
    setAttribute(name,value) {this[name]=value;}, addEventListener(name,callback) {this.events[name]=callback;},
    get innerHTML() {return escape(this.textContent) + this.children.map(child => `<${child.tag}${child.open ? " open" : ""}>${child.innerHTML}</${child.tag}>`).join("");},
  })};
  globalThis.location = {origin:"https://hmpeds.com"};
  try {run();} finally {Object.assign(globalThis, previous);}
}
const invoice = {kind:"invoice",number:"HMP-TEST",client_name:"Test Client",total:850,subtotal:850,items:[{description:"Test service",quantity:1,rate:850,amount:850}]};

test("proposal messages start collapsed while preview/print cards remain expanded", () => withDOM(() => {
  const proposal = {title:"Test Proposal",machines:2,serviceFee:850,calendarUrl:"https://calendar.app.google/CJn7HCVgHaqHM2fK6"};
  const card = renderProposalMessage(proposal);
  const all = descendants(card);
  assert.equal(all.find(node => node.tag === "summary").textContent, "View proposal");
  assert.ok(!all.find(node => node.tag === "details").open);
  assert.match(content(card), /HMP service fee: \$850\.00/);
  assert.match(content(card), /2 Money Counting Machines/);
  assert.equal(all.find(node => node.tag === "a").href, proposal.calendarUrl);
  assert.ok(all.some(node => node.tag === "button" && node.textContent === "Print / Save PDF"));
  assert.ok(!descendants(renderProposalCard(proposal,{showActions:false})).some(node => ["details","button"].includes(node.tag)));
}));

test("invoice and contract copies offer print at the bottom without changing the snapshot", () => withDOM(() => {
  for (const copy of [invoice,{kind:"contract",number:"CON-TEST",total_amount:850,scope_of_work:"Test scope"}]) {
    const before = structuredClone(copy);
    const card = renderDocumentCard(copy);
    assert.ok(!descendants(card).find(node => node.tag === "details").open);
    assert.match(content(card), /Copy as sent/);
    assert.equal(descendants(card).find(node => node.tag === "button").textContent, "Print / Save PDF");
    const printable = renderDocumentCard(copy,{showActions:false,expanded:true});
    assert.equal(descendants(printable).find(node => node.tag === "details").open, true);
    assert.ok(!descendants(printable).some(node => node.tag === "button"));
    assert.deepEqual(copy,before);
  }
}));

test("print opens a full escaped copy and reports blocked popups", () => withDOM(() => {
  let html="",printed=false;
  const popup={document:{write(value){html=value;},close(){}},focus(){},print(){printed=true;}};
  globalThis.window={open:()=>popup,setTimeout:callback=>callback()};
  assert.equal(printDocumentCopy({...invoice,client_name:"<script>bad</script>"}),true);
  assert.equal(printed,true);
  assert.match(html, /<details open>/);
  assert.match(html, /Test service/);
  assert.match(html, /&lt;script&gt;bad/);
  assert.doesNotMatch(html, /<script>|<button>/);
  globalThis.window.open=()=>null;
  const card=renderDocumentCard(invoice);
  descendants(card).find(node=>node.tag === "button").events.click();
  assert.match(content(card), /Allow pop-ups/);
  assert.equal(printDocumentCopy({kind:"invalid"}),false);
}));

test("both message views use the collapsed proposal renderer", () => {
  for (const file of ["src/admin.js","conversation.js"]) {
    const source=readFileSync(new URL(`../${file}`,import.meta.url),"utf8");
    assert.match(source,/article\.append\(renderProposalMessage\(proposal\)\)/);
    assert.doesNotMatch(source,/article\.append\(renderProposalCard\(proposal\)\)/);
  }
});
