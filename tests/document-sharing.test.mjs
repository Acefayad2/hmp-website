import test from "node:test";
import assert from "node:assert/strict";
import {businessDate, expiryDateAfter, linkExpiration, clientMessageAccess} from "../document-expiry.mjs";
import {latestPublishedDocuments} from "../document-versions.mjs";
import {hubSectionFor} from "../client-hub.js";
import {createShareDocumentHandler} from "../netlify/functions/hmp-share-document.mts";

test("calendar expiration validates bounds and uses Eastern end-of-day across DST",()=>{
  const now=new Date("2026-10-22T20:00:00Z");
  assert.equal(linkExpiration("2026-10-22",now),"2026-10-23T03:59:59.999Z");
  assert.equal(linkExpiration("2026-11-01",now),"2026-11-02T04:59:59.999Z");
  assert.equal(expiryDateAfter(30,now),"2026-11-21");
  assert.equal(businessDate(new Date("2026-10-23T01:00:00Z")),"2026-10-22");
  for(const value of ["",null,"2026-02-30","2026-10-21","2026-11-22","2026-10-22T00:00:00Z"]) assert.throws(()=>linkExpiration(value,now));
});

test("expired documents are redacted server-side, without exposing an older version",()=>{
  for(const kind of ["invoice","contract","receipt","form"]){
    const messages=[{id:"old",sender:"admin",created_at:"2026-01-01",document:{kind,id:"same",total:999}},
      {id:"new",sender:"admin",created_at:"2026-02-01",body:"private",attachments:[{path:"private"}],document:{kind,id:"same",total:100,expiresAt:"2026-03-01"}}];
    const visible=latestPublishedDocuments(messages).map(m=>clientMessageAccess(m,Date.parse("2026-03-02")));
    assert.equal(visible.length,1); assert.equal(visible[0].id,"new");
    assert.equal(visible[0].document.expired,true); assert.equal(visible[0].body,"");
    assert.deepEqual(visible[0].attachments,[]); assert.equal(visible[0].document.total,undefined);
  }
  const proposal={sender:"admin",body:'HMP_PROPOSAL_V1:{"serviceFee":500,"linkExpiresAt":"2026-03-01"}'};
  assert.equal(clientMessageAccess(proposal,Date.parse("2026-03-02")).document.kind,"proposal");
  const legacy={sender:"admin",body:"message",document:{kind:"invoice",id:"legacy"}};
  assert.deepEqual(clientMessageAccess(legacy),legacy);
  assert.equal(hubSectionFor({sender:"admin",document:{kind:"receipt"}}),"receipts");
});

const id="11111111-1111-4111-8111-111111111111", inquiryId="22222222-2222-4222-8222-222222222222";
globalThis.Netlify={env:{get:key=>({HMP_ADMIN_EMAILS:"admin@example.test",SUPABASE_SERVICE_ROLE_KEY:"test-secret"})[key]}};
function database(){
  const rows={hmp_client_conversations:[{id,inquiry_id:inquiryId,token_nonce:"nonce",token_expires_at:"2099-01-01"}],
    hmp_admin_inquiries:[{submission_id:inquiryId,email:"client@example.test",celebration_date:"2026-10-20"}],hmp_client_messages:[],hmp_admin_invoices:[]};
  return {rows,from(table){let filters=[],op="read",payload;
    const q={select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},insert(v){op="insert";payload=v;return this;},update(v){op="update";payload=v;return this;},
      execute(single=false){let found=rows[table].filter(r=>filters.every(f=>f(r)));
        if(op==="insert"){if(rows[table].some(r=>r.id===payload.id))return {data:null,error:{code:"23505"}}; rows[table].push(structuredClone(payload));found=[payload];}
        if(op==="update")found.forEach(r=>Object.assign(r,payload));return {data:single?found[0]||null:found,error:null};},
      maybeSingle(){return Promise.resolve(this.execute(true));},then(a,b){return Promise.resolve(this.execute()).then(a,b);}};return q;}};
}
const body=()=>({kind:"receipt",conversationId:id,expirationDate:expiryDateAfter(7),details:{receiptNumber:"R-TEST",clientName:"Test Client",clientEmail:"client@example.test",eventDate:"2026-10-20",serviceDescription:"Service",serviceTotal:"100",amountPaid:"40",paymentDate:"2026-10-20",paymentMethod:"Cash",confirmed:true}});
const request=(value=body(),origin="https://hmpeds.com")=>new Request("https://hmpeds.com/api/hmp-documents/share",{method:"POST",headers:{Origin:origin},body:JSON.stringify(value)});
test("receipt publication is validated, private, idempotent, and does not alter invoice payments",async()=>{
  const db=database(),h=createShareDocumentHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>db});
  const response=await h(request()); assert.equal(response.status,200); assert.match((await response.json()).clientUrl,/section=receipts/);
  assert.equal((await h(request())).status,200); assert.equal(db.rows.hmp_client_messages.length,1);
  const receipt=db.rows.hmp_client_messages[0].document.receipt;
  assert.equal(receipt.amountPaid,40); assert.equal(receipt.balance,60);
  assert.equal(db.rows.hmp_admin_invoices.length,0);
  const invalid=body(); invalid.details.confirmed=false; assert.equal((await h(request(invalid))).status,400);
  invalid.details.confirmed=true; invalid.details.amountPaid="101"; assert.equal((await h(request(invalid))).status,400);
  assert.equal((await h(request(body(),"https://other.test"))).status,403);
  assert.equal((await createShareDocumentHandler({getUserFn:async()=>null,databaseFactory:()=>db})(request())).status,401);
  db.rows.hmp_admin_inquiries[0].email="other@example.test"; assert.equal((await h(request())).status,400);
  db.rows.hmp_admin_inquiries[0].email="client@example.test"; db.rows.hmp_admin_inquiries[0].celebration_date="2026-10-21";
  assert.equal((await h(request())).status,400);
  db.rows.hmp_client_conversations[0].revoked_at="2026-10-01"; assert.equal((await h(request())).status,400);
});
