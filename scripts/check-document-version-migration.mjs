// Synthetic in-memory database only. No production data or network writes.
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table hmp_admin_invoices(id uuid primary key,status text,invoice_number text unique,total numeric,client_email text,created_by text,created_at timestamptz,updated_at timestamptz,sent_at timestamptz,sent_to text,email_message_id text,archived_at timestamptz,deleted_at timestamptz);
    create table hmp_admin_contracts(id uuid primary key,status text,contract_number text unique,total_amount numeric,client_email text,client_signature_name text,client_signed_at date,hmp_signature_name text,hmp_signed_at date,created_by text,created_at timestamptz,updated_at timestamptz,sent_at timestamptz,sent_to text,email_message_id text);
    create table hmp_client_agreements(id uuid primary key,status text,snapshot jsonb,admin_answers jsonb,client_answers jsonb,signature jsonb,record_hash text,token_nonce text,token_hash text unique,completed_at timestamptz,expires_at timestamptz,email_delivered_at timestamptz,created_by text,created_at timestamptz,updated_at timestamptz,sent_at timestamptz);
    create table hmp_admin_proposal_drafts(id uuid primary key,conversation_id uuid,payload jsonb,created_by text,created_at timestamptz,updated_at timestamptz,sent_at timestamptz,sent_message_id uuid);
    create table hmp_client_messages(id uuid primary key,conversation_id uuid,sender text,body text,created_at timestamptz,deleted_at timestamptz);
    grant all on hmp_admin_invoices,hmp_admin_contracts,hmp_client_agreements,hmp_admin_proposal_drafts,hmp_client_messages to service_role;`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261018150750_document_version_registry.sql",import.meta.url),"utf8"));
  const clone=async(kind,source,newId=crypto.randomUUID())=>{
    const result=await db.query("select hmp_create_document_revision($1,$2,$3,$4,$5,$6) id",[kind,source,newId,"n".repeat(32),newId.replaceAll("-","").repeat(2),"qa@example.test"]);
    return result.rows[0].id;
  };
  for(const kind of ["invoice","contract","form","proposal"]){
    const source=crypto.randomUUID();
    const table={invoice:"hmp_admin_invoices",contract:"hmp_admin_contracts",form:"hmp_client_agreements",proposal:"hmp_admin_proposal_drafts"}[kind];
    if(kind==="invoice")await db.query("insert into hmp_admin_invoices(id,status,invoice_number,total,sent_at) values($1,'Paid','QA-1',100,now())",[source]);
    if(kind==="contract")await db.query("insert into hmp_admin_contracts(id,status,contract_number,total_amount,client_signature_name,client_signed_at,sent_at) values($1,'Signed','QA-1',100,'Original signer','2026-10-18',now())",[source]);
    if(kind==="form")await db.query("insert into hmp_client_agreements(id,status,snapshot,admin_answers,client_answers,signature,record_hash,token_nonce,token_hash,completed_at,sent_at) values($1,'Completed','{}','{\"hmpConsent\":\"yes\"}','{\"answer\":\"original\"}','{\"name\":\"signer\"}','original-hash','original-nonce','original-token',now(),now())",[source]);
    if(kind==="proposal")await db.query("insert into hmp_admin_proposal_drafts(id,payload,sent_at) values($1,'{\"title\":\"Original\"}',now())",[source]);
    const before=(await db.query(`select * from ${table} where id=$1`,[source])).rows[0];
    await db.exec("set role service_role");
    const next=await clone(kind,source);
    assert.equal(await clone(kind,source,next),next,"Retries are idempotent");
    await assert.rejects(clone(kind,source),/editable draft already exists/);
    const row=(await db.query(`select * from ${table} where id=$1`,[next])).rows[0];
    assert.equal(row.sent_at,null);if(kind!=="proposal")assert.equal(row.status,"Draft");
    if(kind==="contract")assert.equal(row.client_signature_name,null);
    if(kind==="form"){assert.equal(row.signature,null);assert.deepEqual(row.client_answers,{});assert.equal(row.record_hash,null);}
    assert.deepEqual((await db.query(`select * from ${table} where id=$1`,[source])).rows[0],before,"Original is never modified");
    await db.exec("reset role");
    for(let i=0;i<5;i++){
      await db.query(`update ${table} set sent_at=now()${kind==="proposal"?"":",status='Sent'"} where id<>$1`,[source]);
      await clone(kind,source);
    }
    const versions=(await db.query("select version from hmp_document_versions where kind=$1 and root_id=$2 order by version",[kind,source])).rows;
    assert.deepEqual(versions.map(v=>v.version),[1,2,3,4,5,6,7],"Older than five versions stay stored");
  }
  const message=crypto.randomUUID();
  await db.query("insert into hmp_client_messages(id,sender,body,created_at) values($1,'admin','HMP_PROPOSAL_V1:{\"title\":\"Legacy\"}',now())",[message]);
  const draft=await clone("proposal",message);
  assert.equal((await db.query("select payload->>'title' title from hmp_admin_proposal_drafts where id=$1",[draft])).rows[0].title,"Legacy");
  for(const role of ["anon","authenticated"]){
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select * from hmp_document_versions"),/permission denied/);
    await assert.rejects(clone("proposal",message),/permission denied/);
    await db.exec("reset role");
  }
  console.log("Version registry verified: four kinds, immutable originals, cleared signatures/payments, idempotent retries, draft conflict protection, retained archives, legacy proposals and denied public access.");
} finally {await db.close();}
