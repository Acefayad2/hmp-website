import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {cleanBankProgress} from "../agreement-progress.mjs";
import {getAgreementTemplate} from "../agreement-schema.mjs";
import {publicAgreement} from "../netlify/functions/_agreement-forms.mts";
const snapshot=getAgreementTemplate("money-bank-verification");
test("shared progress preserves initials but never signatures, dates, consent or private tokens",()=>{
  const values={actualBank:"125",receivedInitials:"AB",reconciledInitials:"CD",representativeOneName:"Test Person",representativeOneSignature:"NO",representativeTwoSignature:"NO",signatureName:"NO",signatureDrawings:{strokes:[]},representativeOneDate:"2026-10-29",representativeTwoDate:"2026-10-29",attendantDate:"2026-10-29",consent:true,token:"NO"};
  assert.deepEqual(cleanBankProgress(snapshot,values),{actualBank:"125",receivedInitials:"AB",reconciledInitials:"CD",representativeOneName:"Test Person"});
  for(const value of [null,[],"bad"])assert.throws(()=>cleanBankProgress(snapshot,value));
  for(const value of [{actualBank:3},{actualBank:"x".repeat(5001)}])assert.throws(()=>cleanBankProgress(snapshot,value));
});
test("only unfinished bank forms expose progress and stored signing fields are filtered",()=>{
  const row={snapshot,status:"Sent",updated_at:"test",bank_progress:{receivedInitials:"AB",representativeOneSignature:"NO"}};
  assert.deepEqual(publicAgreement(row).bankProgress,{values:{receivedInitials:"AB"},updatedAt:"test"});
  for(const status of ["Completed","Void"])assert.equal(publicAgreement({...row,status}).bankProgress,undefined);
  assert.equal(publicAgreement({...row,snapshot:{...snapshot,id:"other"}}).bankProgress,undefined);
});
test("client saves shared progress, prefers server values, and submits its reviewed version",()=>{
  const client=readFileSync(new URL("../agreement-client.mjs",import.meta.url),"utf8");
  assert.match(client,/\.\.\.savedDraft\?\.values, \.\.\.agreement.bankProgress\?\.values/);
  assert.match(client,/action:"save-progress",agreementId:agreement.id,updatedAt:agreement.updatedAt/);
  assert.match(client,/progressUpdatedAt:agreement.updatedAt/);
  assert.doesNotMatch(client,/saveDraft\(localStorage/);
  assert.match(client,/Details and initials saved/);
});
