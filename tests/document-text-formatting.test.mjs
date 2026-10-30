import test from "node:test";
import assert from "node:assert/strict";
import {normalizeTextFormatting,richTextHTML} from "../text-formatting.mjs";
import {normalizeProposal,parseProposal,serializeProposal} from "../proposal-ui.js";
import {normalizeAdminMessage} from "../netlify/functions/hmp-messages.mts";
import {cleanPayload as invoicePayload,normalizeInvoice} from "../netlify/functions/hmp-invoices.mts";
import {cleanPayload as contractPayload,normalizeContract} from "../netlify/functions/hmp-contracts.mts";
import {documentSnapshot} from "../netlify/functions/_document-messages.mts";
import {editableSnapshot,snapshotFor,issuedSnapshot} from "../netlify/functions/_agreement-forms.mts";
import {answersHTML} from "../agreement-ui.mjs";
import {receiptDraftPayload} from "../receipt-draft.mjs";
import {createStandaloneReceipt,receiptHTML} from "../receipt-template.mjs";
const marks=[{start:0,end:4,bold:true,italic:true,underline:true,align:"center",list:"number"}];
test("bounded allowlisted formatting trims with text and never stores HTML",()=>{
  const value=normalizeTextFormatting({notes:"  Test  ",textFormatting:{notes:[{...marks[0],start:2,end:6,html:'<img onerror=alert(1)>',style:'color:red'}],clientEmail:marks}}, {notes:"Test"},["notes"]);
  assert.deepEqual(value,{textFormatting:{notes:marks}});
  assert.throws(()=>normalizeTextFormatting({notes:"Test",textFormatting:{notes:[{start:0,end:10}]}},{notes:"Test"},["notes"]),/formatting/);
  assert.throws(()=>normalizeTextFormatting({notes:"Test",textFormatting:[]},{notes:"Test"},["notes"]),/Invalid/);
  const html=richTextHTML('<script>bad</script>',[{start:0,end:19,bold:true,align:'center',list:'number'}]);
  assert.match(html,/<ol/);assert.match(html,/text-align:center/);assert.match(html,/<strong>&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.match(richTextHTML("Preserved text",[{start:0,end:1000}]),/Preserved text/);
});
test("proposal styling survives normalization, draft JSON, send and client parsing",()=>{
  const proposal={clientName:"Synthetic",serviceFee:100,notes:"Test",textFormatting:{notes:marks}};
  const normalized=normalizeProposal(proposal);
  assert.deepEqual(parseProposal(normalizeAdminMessage(serializeProposal(normalized))),normalized);
  const many={...proposal,serviceDetails:"a".repeat(1400),textFormatting:{serviceDetails:Array.from({length:300},(_,i)=>({start:i,end:i+1,bold:!!(i%2),italic:true}))}};
  assert.ok(serializeProposal(many).length>4000);
  assert.deepEqual(parseProposal(normalizeAdminMessage(serializeProposal(many))).textFormatting,normalizeProposal(many).textFormatting);
  assert.equal(normalizeAdminMessage("x".repeat(5000)).length,4000);
});
test("invoice and agreement draft metadata reaches immutable sent copies and reopened revisions",()=>{
  const invoice=invoicePayload({clientName:"Synthetic",clientEmail:"qa@example.test",issueDate:"2026-10-30",notes:"Test",textFormatting:{notes:marks},items:[{description:"Test",quantity:1,rate:100,textFormatting:{description:marks}}]});
  assert.deepEqual(normalizeInvoice(invoice).textFormatting,{notes:marks});
  const copy=documentSnapshot("invoice",invoice);
  assert.deepEqual(copy.textFormatting,{notes:marks});assert.deepEqual(copy.items[0].textFormatting,{description:marks});
  const agreement=contractPayload({clientName:"Synthetic",clientEmail:"qa@example.test",effectiveDate:"2026-10-30",services:"Service",scopeOfWork:"Test",textFormatting:{scopeOfWork:marks}});
  assert.deepEqual(normalizeContract(agreement).textFormatting,{scopeOfWork:marks});
  assert.deepEqual(documentSnapshot("contract",agreement).textFormatting,{scope_of_work:marks});
});
test("Money Bank additional information formatting stays in saved and issued snapshots",()=>{
  const template=snapshotFor("money-bank-verification");
  const field=template.adminFields.find(f=>f.type==="textarea");assert.ok(field);
  const snapshot=editableSnapshot(template,{answers:{[field.id]:"Test"},answerFormatting:{[field.id]:marks}});
  assert.deepEqual(issuedSnapshot(snapshot,{}).answerFormatting,{[field.id]:marks});
  assert.match(answersHTML(snapshot.adminFields,{[field.id]:"Test"},snapshot.answerFormatting),/<strong><em><u>Test<\/u><\/em><\/strong>/);
  assert.deepEqual(template.answerFormatting,undefined);
});
test("receipt formatting round trips through private drafts and issued print output",()=>{
  const input={receiptMode:"standalone",receiptNumber:"QA",clientName:"Synthetic",serviceDescription:"Test",note:"Test",amountPaid:"10",paymentMethod:"Cash",paymentDate:"2026-10-30",textFormatting:{note:marks,serviceDescription:marks}};
  const draft=receiptDraftPayload(input);
  const issued=createStandaloneReceipt({...draft,confirmed:true},"2026-10-30");
  assert.deepEqual(issued.textFormatting,input.textFormatting);
  assert.equal((receiptHTML(issued).match(/<strong><em><u>Test<\/u><\/em><\/strong>/g)||[]).length,2);
});
