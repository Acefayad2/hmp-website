import test from "node:test";
import assert from "node:assert/strict";
import { createInvoiceHandler } from "../netlify/functions/hmp-invoices.mts";
import { createContractHandler } from "../netlify/functions/hmp-contracts.mts";

globalThis.Netlify = {env:{get:(name) => ({HMP_ADMIN_EMAILS:"admin@example.test",SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-secret"})[name] || ""}};
const originalId = "11111111-1111-4111-8111-111111111111";
const request = (path, method, body) => new Request(`https://hmpeds.com/api/${path}`, {
  method, headers:{"Content-Type":"application/json", Origin:"https://hmpeds.com"}, body:JSON.stringify(body),
});

function database(rows) {
  return {from(table) {
    let filters = [], operation = "read", payload;
    const query = {
      select(){return this;}, order(){return this;}, limit(){return this;},
      eq(key,value){filters.push(row => row[key] === value); return this;},
      is(key,value){filters.push(row => row[key] === value); return this;},
      insert(value){operation="insert"; payload=value; return this;},
      update(value){operation="update"; payload=value; return this;},
      execute(single=false) {
        let found = rows[table].filter(row => filters.every(filter => filter(row)));
        if (operation === "insert") {
          const row = {id:crypto.randomUUID(),
            ...(table === "hmp_admin_invoices" ? {invoice_number:"HMP-I-NEW"} : {}), ...payload};
          rows[table].push(row); found=[row];
        }
        if (operation === "update") found.forEach(row => Object.assign(row,payload));
        return {data:single ? found[0] || null : found, error:null};
      },
      single(){return Promise.resolve(this.execute(true));},
      maybeSingle(){return Promise.resolve(this.execute(true));},
      then(resolve,reject){return Promise.resolve(this.execute()).then(resolve,reject);},
    };
    return query;
  }};
}

const invoice = () => ({
  id:originalId, invoice_number:"HMP-I-OLD", status:"Paid", issue_date:"2026-10-01",
  due_date:"2026-10-20", client_name:"Test Client", client_email:"client@example.test",
  items:[{id:"line",description:"Service",quantity:1,rate:100,amount:100}], subtotal:100,
  tax_rate:0,tax_amount:0,discount_amount:0,total:100,revision_number:1,
  archived_at:null,deleted_at:null,
});
const contract = () => ({
  id:originalId, contract_number:"HMP-C-OLD", status:"Signed", effective_date:"2026-10-01",
  client_name:"Test Client",client_email:"client@example.test",services:"Service",
  scope_of_work:"Work",total_amount:100,retainer_amount:20,
  client_signature_name:"Test Client",client_signed_at:"2026-10-02",revision_number:1,
});

test("paid invoice revision is a new draft and the paid record cannot be overwritten", async () => {
  const original=invoice(), rows={hmp_admin_invoices:[original]};
  const handler=createInvoiceHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>database(rows)});
  const response=await handler(request("hmp-invoices","POST",{action:"revise",id:originalId}));
  assert.equal(response.status,201);
  const {invoice:revision}=await response.json();
  assert.equal(revision.status,"Draft");
  assert.equal(revision.revisionGroupId,originalId);
  assert.equal(revision.revisionNumber,2);
  assert.notEqual(revision.id,originalId);
  assert.equal(original.status,"Paid");
  const overwrite=await handler(request("hmp-invoices","PATCH",{...revision,id:originalId}));
  assert.equal(overwrite.status,409);
  assert.equal(original.total,100);
});

test("signed contract revision clears signatures without altering the signed original", async () => {
  const original=contract(), rows={hmp_admin_contracts:[original]};
  const handler=createContractHandler({getUserFn:async()=>({email:"admin@example.test"}),databaseFactory:()=>database(rows)});
  const response=await handler(request("hmp-contracts","POST",{action:"revise",id:originalId}));
  assert.equal(response.status,201);
  const {contract:revision}=await response.json();
  assert.equal(revision.status,"Draft");
  assert.equal(revision.revisionGroupId,originalId);
  assert.equal(revision.revisionNumber,2);
  assert.equal(revision.clientSignatureName,"");
  assert.equal(revision.clientSignedAt,"");
  assert.equal(original.client_signature_name,"Test Client");
  const overwrite=await handler(request("hmp-contracts","PATCH",{...revision,id:originalId}));
  assert.equal(overwrite.status,409);
});

test("revision actions reject cross-origin requests", async () => {
  const invoiceRows={hmp_admin_invoices:[invoice()]};
  const contractRows={hmp_admin_contracts:[contract()]};
  const auth={getUserFn:async()=>({email:"admin@example.test"})};
  const invoiceHandler=createInvoiceHandler({...auth,databaseFactory:()=>database(invoiceRows)});
  const contractHandler=createContractHandler({...auth,databaseFactory:()=>database(contractRows)});
  for (const [handler,path] of [[invoiceHandler,"hmp-invoices"],[contractHandler,"hmp-contracts"]]) {
    const bad=new Request(`https://hmpeds.com/api/${path}`, {method:"POST",headers:{Origin:"https://elsewhere.test","Content-Type":"application/json"},body:JSON.stringify({action:"revise",id:originalId})});
    assert.equal((await handler(bad)).status,403);
  }
  assert.equal(invoiceRows.hmp_admin_invoices.length,1);
  assert.equal(contractRows.hmp_admin_contracts.length,1);
});
