import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {agreementListRows, agreementRowsHTML, updateAgreementList} from "../src/agreement-list.js";

const native = {id:"native",template_id:"guest-seating",client_name:"Template Client",client_email:"template@example.test",created_at:"2026-10-26",event_date:"2026-12-01",service_fee:"500",status:"Completed"};
const manual = {id:"manual",clientName:"Custom Client",clientEmail:"custom@example.test",contractNumber:"HMP-001",createdAt:"2026-10-25",eventDate:"2026-12-02",totalAmount:700,status:"Sent"};

test("agreements merge both sources newest first, preserving routing and source records", () => {
  const originals = structuredClone([manual,native]);
  const rows = agreementListRows([manual],[native]);
  assert.deepEqual(rows.map(r=>[r.kind,r.id]), [["agreement","native"],["contract","manual"]]);
  const html = agreementRowsHTML(rows);
  assert.match(html,/data-agreement-id="native"/);
  assert.match(html,/data-contract-id="manual"/);
  assert.match(html,/Dec 1, 2026/);
  assert.match(html,/\$500\.00/);
  assert.match(html,/\$700\.00/);
  assert.deepEqual([manual,native], originals);
});

test("revision families stay separate across sources, intake and bank forms remain in Forms", () => {
  const rows = agreementListRows([manual,{...manual,id:"revision",revisionRootId:manual.id,createdAt:"2026-10-27"}], [
    {...native,id:manual.id}, {...native,id:"bank",template_id:"money-bank-verification"},
    {...native,id:"intake",template_id:"money-changing-details"},
    {...native,id:"older",revision_root_id:manual.id,created_at:"2026-10-24"},
  ]);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>r.id),["revision",manual.id]);
});

test("fees use the relevant template field; missing values are not invented", () => {
  const rows=agreementListRows([], [
    {...native,id:"accessories",template_id:"accessories",total_due:"850"},
    {...native,id:"approval",template_id:"customization-approval",approval_fee:"0"},
    {...native,id:"led",template_id:"led-customization",customization_fee:"75"},
    {...native,id:"empty",service_fee:"",event_date:null},
  ]);
  assert.deepEqual(rows.map(r=>r.value),["850","0","75",""]);
  const html=agreementRowsHTML(rows);
  assert.match(html,/\$0\.00/);
  assert.match(html,/Not provided/);
  assert.doesNotMatch(agreementRowsHTML(agreementListRows([], [{...native,service_fee:"invalid",event_date:"invalid"}])),/NaN|Invalid Date/);
});

test("all record-controlled content and attributes are escaped", () => {
  const html=agreementRowsHTML(agreementListRows([], [{...native,id:'"><img src=x>',client_name:"<script>alert(1)</script>",document_title:"<b>Title</b>",event_name:'" onclick="bad()'}]));
  assert.doesNotMatch(html,/<script>|<img|<b>|" onclick=/);
  assert.match(html,/&lt;script&gt;/);
});

test("combined loading, empty, partial failure and recovery states do not hide available rows", () => {
  const nodes=Object.fromEntries(["#contract-list","#contract-empty","#agreement-list-message"].map(id=>[id,{hidden:false,innerHTML:"",textContent:"",classList:{toggle(){}},setAttribute(){}}]));
  const previous=globalThis.document;
  globalThis.document={querySelector:id=>nodes[id]};
  try {
    updateAgreementList("contracts",{rows:[],loading:false,error:""});
    assert.equal(nodes["#contract-empty"].hidden,true);
    updateAgreementList("agreements",{rows:[],loading:false,error:""});
    assert.equal(nodes["#contract-empty"].hidden,false);
    updateAgreementList("agreements",{rows:[native],loading:false,error:""});
    updateAgreementList("contracts",{loading:false,error:"Custom agreements unavailable"});
    assert.equal(nodes["#contract-empty"].hidden,true);
    assert.equal(nodes["#contract-list"].hidden,false);
    assert.match(nodes["#agreement-list-message"].textContent,/unavailable/);
    updateAgreementList("contracts",{rows:[manual],loading:false,error:""});
    assert.equal(nodes["#agreement-list-message"].textContent,"");
    assert.match(nodes["#contract-list"].innerHTML,/data-contract-id/);
    assert.match(nodes["#contract-list"].innerHTML,/data-agreement-id/);
  } finally {globalThis.document=previous;}
});

test("single list markup retains five columns, templates, creation and both click handlers", () => {
  const html=readFileSync(new URL("../admin.html",import.meta.url),"utf8");
  assert.doesNotMatch(html,/id="agreement-list"|<h3>Agreement records<\/h3>/);
  assert.match(html,/<span>Agreement<\/span><span>Client<\/span><span>Event date<\/span><span>Value<\/span><span>Status<\/span>/);
  assert.match(html,/id="create-contract-button"[^>]*>Create new agreement/);
  assert.match(html,/id="agreement-template-list"/);
  for(const file of ["admin.js","agreement-admin.js"]){
    assert.match(readFileSync(new URL(`../src/${file}`,import.meta.url),"utf8"),/\$\("#contract-list"\)\.addEventListener\("click"/);
  }
});
