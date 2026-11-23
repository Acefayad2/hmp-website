import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mountBackToTop} from "../src/back-to-top.js";

class Element {
  constructor(tag) { this.tagName=tag; this.children=[]; this.listeners={}; this.hidden=false; }
  append(child) { this.children.push(child); }
  setAttribute(name,value) { this[name]=value; }
  addEventListener(name,listener) { this.listeners[name]=listener; }
}

test("document back-to-top control appears after scrolling and returns smoothly", () => {
  const body=new Element("body"), head=new Element("head");
  const root={body,head,documentElement:{scrollTop:0},createElement:tag => new Element(tag),getElementById:() => null};
  const calls=[];
  const viewport={scrollY:0,addEventListener(name,listener){this[name]=listener;},requestAnimationFrame(callback){callback();},matchMedia(){return {matches:false};},scrollTo(options){calls.push(options);}};
  const button=mountBackToTop({root,viewport,threshold:100});
  assert.equal(button.hidden,true);
  viewport.scrollY=101;
  viewport.scroll();
  assert.equal(button.hidden,false);
  button.listeners.click();
  assert.deepEqual(calls,[{top:0,behavior:"smooth"}]);
  assert.equal(button["aria-label"],"Back to top of document");
});

test("all document-completion entry points mount the shared control", () => {
  for (const file of ["../src/admin.js","../agreement-client.mjs","../review-client.mjs"]) {
    assert.match(readFileSync(new URL(file, import.meta.url),"utf8"),/mountBackToTop/);
  }
  assert.match(readFileSync(new URL("../scripts/build-admin.mjs", import.meta.url),"utf8"),/"src\/back-to-top\.js"/);
});
