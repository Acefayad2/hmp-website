import test from "node:test";
import assert from "node:assert/strict";
import {validateSignatureDrawing, signatureDrawingHTML} from "../signature-pad.mjs";
import {completionHTML} from "../agreement-ui.mjs";
const strokes=[[[10,20],[40,50],[100,25]]];
test("drawings accept only bounded numeric strokes and reject blank, huge or injected content",()=>{
  assert.deepEqual(validateSignatureDrawing(strokes),strokes);
  for(const invalid of [null,[],"<svg onload=alert(1)>",[[[1,1]]],[[[0,0],[1001,0]]],[[[0,0],[1,NaN]]],Array(81).fill(strokes[0]),[Array(1001).fill([1,2])]]) assert.throws(()=>validateSignatureDrawing(invalid));
  assert.match(signatureDrawingHTML(strokes),/polyline points="10,20 40,50 100,25"/);
});
test("completed forms and PDF renderer include each stored drawing without changing originals",()=>{
  const record={id:"test",snapshot:{clientFields:[],signatureMode:"on-site-three-signatures"},clientAnswers:{},adminAnswers:{},signature:{name:"HMP",drawings:{representativeOneSignature:{strokes,consent:"Authorized"},signatureName:{strokes,consent:"Authorized"}}}};
  const before=structuredClone(record),html=completionHTML(record);
  assert.equal((html.match(/<svg /g)||[]).length,2);
  assert.match(html,/First representative/);assert.deepEqual(record,before);
  assert.doesNotMatch(completionHTML({...record,signature:{name:"Original typed signature"}}),/<svg /);
});
