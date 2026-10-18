// Synthetic in-memory database only. No production data or network writes.
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table hmp_admin_invoices(id uuid primary key,status text,invoice_number text unique,total numeric,inquiry_id uuid,client_email text,created_by text,created_at timestamptz,updated_at timestamptz,sent_at timestamptz,sent_to text,email_message_id text,archived_at timestamptz,deleted_at timestamptz);
    create table hmp_admin_contracts(id uuid primary key,status text,contract_number text unique,total_amount numeric,inquiry_id uuid,client_email text,client_signature_name text,client_signed_at date,hmp_signature_name text,hmp_signed_at date,created_by text,created_at timestamptz,updated_at timestamptz,sent_at timestamptz,sent_to text,email_message_id text);
    create table hmp_client_agreements(id uuid primary key,status text,client_email text,snapshot jsonb,admin_answers jsonb,client_answers jsonb,signature jsonb,record_hash text,token_nonce text,token_hash text unique,completed_at timestamptz,expires_at timestamptz,email_delivered_at timestamptz,created_by text,created_at timestamptz,updated_at timestamptz,sent_at timestamptz);
    create table hmp_admin_proposal_drafts(id uuid primary key,conversation_id uuid,payload jsonb,created_by text,created_at timestamptz,updated_at timestamptz,sent_at timestamptz,sent_message_id uuid);
    create table hmp_client_messages(id uuid primary key,conversation_id uuid,sender text,sender_name text,body text,document jsonb,created_at timestamptz default now(),deleted_at timestamptz);
    create table hmp_admin_inquiries(submission_id uuid primary key,email text);
    create table hmp_client_conversations(id uuid primary key,inquiry_id uuid,revoked_at timestamptz,token_expires_at timestamptz,last_message_at timestamptz,last_sender text,updated_at timestamptz);
    grant all on hmp_admin_invoices,hmp_admin_contracts,hmp_client_agreements,hmp_admin_proposal_drafts,hmp_client_messages,hmp_admin_inquiries,hmp_client_conversations to service_role;
    create function hmp_preserve_completed_agreement() returns trigger language plpgsql as $$begin if old.status='Completed' then raise exception 'Completed agreements cannot be changed'; end if;return new;end;$$;
    create trigger hmp_preserve_completed_agreement before update or delete on hmp_client_agreements for each row execute function hmp_preserve_completed_agreement();`);
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
      await db.query(`update ${table} set sent_at=now()${kind==="proposal"?"":",status='Sent'"} where id<>$1${kind==="proposal"?" and sent_at is null":" and status='Draft'"}`,[source]);
      await clone(kind,i===0?next:source);
    }
    const versions=(await db.query("select version from hmp_document_versions where kind=$1 and root_id=$2 order by version",[kind,source])).rows;
    assert.deepEqual(versions.map(v=>v.version),[1,2,3,4,5,6,7],"Older than five versions stay stored");
    if(kind==="invoice"||kind==="contract"){
      const field=kind==="invoice"?"total":"total_amount";
      await assert.rejects(db.query(`update ${table} set ${field}=999 where id=$1`,[source]),/issued record is preserved/);
      await assert.rejects(db.query(`update ${table} set status='Draft' where id=$1`,[source]),/issued record is preserved/);
      await assert.rejects(db.query(`update ${table} set client_email='different@example.test' where id=$1`,[next]),/original client/);
    }
  }
  const message=crypto.randomUUID();
  await db.query("insert into hmp_client_messages(id,sender,body,created_at) values($1,'admin','HMP_PROPOSAL_V1:{\"title\":\"Legacy\"}',now())",[message]);
  const draft=await clone("proposal",message);
  assert.equal((await db.query("select payload->>'title' title from hmp_admin_proposal_drafts where id=$1",[draft])).rows[0].title,"Legacy");

  // Same old token resolves the latest issued form, never a private draft.
  const root=crypto.randomUUID(), seed="root-hash";
  await db.query(`insert into hmp_client_agreements(id,status,snapshot,prepared_snapshot,admin_answers,client_answers,token_nonce,token_hash,updated_at,expires_at)
    values($1,'Sent','{"pages":["Original 30%"]}','{"pages":["Original {{retainerPercent}}%"]}','{}','{}','root-seed',$2,now(),now()+interval '1 day')`,[root,seed]);
  const revision=await clone("form",root);
  const resolve=async(token)=> (await db.query("select hmp_resolve_agreement_revision($1) value",[token])).rows[0].value;
  assert.equal((await resolve(seed)).id,root);
  const privateDraft=(await db.query("select * from hmp_client_agreements where id=$1",[revision])).rows[0];
  assert.deepEqual(privateDraft.snapshot,{pages:["Original {{retainerPercent}}%"]},"New drafts retain editable placeholders");
  assert.equal(await resolve(privateDraft.token_hash),null,"A draft's own link is not usable");
  await assert.rejects(db.query("update hmp_client_agreements set client_email='other@example.test' where id=$1",[revision]),/original client/);
  await db.query("update hmp_client_agreements set status='Sent',sent_at=now(),expires_at=now()+interval '7 days',updated_at=now() where id=$1",[revision]);
  assert.equal((await resolve(seed)).id,revision);
  const payload={client_answers:{name:"QA"},signature:{name:"QA"},record_hash:"qa-hash",completed_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const complete=async(token,expected,updated)=> (await db.query("select hmp_complete_agreement_revision($1,$2,$3,$4) value",[token,expected,updated,JSON.stringify(payload)])).rows[0].value;
  assert.equal(await complete(seed,root,(await resolve(seed)).updated_at),null,"Stale pages cannot sign a new version");
  assert.equal(await complete(seed,revision,"2020-01-01"),null,"Stale content cannot be signed");
  assert.equal((await complete(seed,revision,(await resolve(seed)).updated_at)).status,"Completed");
  await assert.rejects(db.query("update hmp_client_agreements set status='Draft' where id=$1",[revision]),/Completed agreements/);
  assert.equal(await complete(seed,revision,payload.updated_at),null,"A signature cannot be replaced");
  await db.query("update hmp_client_agreements set token_hash='rotated-hash' where id=$1",[root]);
  assert.equal(await resolve(seed),null,"Rotated old tokens stay invalid");
  assert.equal(await complete(seed,revision,payload.updated_at),null);

  // Proposal publication links a sent message atomically, with exact payload and conversation checks.
  const convo=crypto.randomUUID(), proposal=crypto.randomUUID(), sent=crypto.randomUUID();
  await db.query("insert into hmp_admin_proposal_drafts(id,conversation_id,payload) values($1,$2,'{\"title\":\"QA\"}')",[proposal,convo]);
  await db.query("insert into hmp_client_messages(id,conversation_id,sender,body) values($1,$2,'admin','HMP_PROPOSAL_V1:{\"title\":\"Wrong\"}')",[sent,convo]);
  const mark=async()=> (await db.query("select hmp_mark_proposal_revision_sent($1,$2,$3) ok",[proposal,sent,convo])).rows[0].ok;
  assert.equal(await mark(),false);
  await db.query("update hmp_client_messages set body='HMP_PROPOSAL_V1:{\"title\":\"QA\"}' where id=$1",[sent]);
  assert.equal(await mark(),true);assert.equal(await mark(),true,"Mark sent retries are idempotent");
  const revisedProposal=await clone("proposal",sent);
  assert.equal((await db.query("select revision_root_id from hmp_admin_proposal_drafts where id=$1",[revisedProposal])).rows[0].revision_root_id,proposal,"Message alias resolves to original draft family");
  await assert.rejects(db.query("update hmp_admin_proposal_drafts set conversation_id=$1 where id=$2",[crypto.randomUUID(),revisedProposal]),/original client conversation/);
  await assert.rejects(db.query("update hmp_admin_proposal_drafts set payload='{}' where id=$1",[proposal]),/Sent proposals are preserved/);
  for(const role of ["anon","authenticated"]){
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select * from hmp_document_versions"),/permission denied/);
    await assert.rejects(clone("proposal",message),/permission denied/);
    await assert.rejects(resolve(seed),/permission denied/);
    await assert.rejects(complete(seed,revision,payload.updated_at),/permission denied/);
    await assert.rejects(mark(),/permission denied/);
    await db.exec("reset role");
  }
  // A copied client link publishes the draft, without an email or a paid status.
  const inquiry=crypto.randomUUID(), conversation=crypto.randomUUID(), invoice=crypto.randomUUID(), shared=crypto.randomUUID();
  await db.query("insert into hmp_admin_inquiries values($1,'qa@example.test')",[inquiry]);
  await db.query("insert into hmp_client_conversations(id,inquiry_id,token_expires_at) values($1,$2,now()+interval '1 day')",[conversation,inquiry]);
  await db.query("insert into hmp_admin_invoices(id,status,invoice_number,total,inquiry_id,client_email) values($1,'Draft','SHARE-QA',100,$2,'qa@example.test')",[invoice,inquiry]);
  const share=()=>db.query("select hmp_record_shared_document('invoice',$1,$2,$3,$4,'qa@example.test','QA')",[invoice,conversation,shared,JSON.stringify({kind:'invoice',id:invoice,number:'SHARE-QA'})]);
  await share();await share();
  const issued=(await db.query("select * from hmp_admin_invoices where id=$1",[invoice])).rows[0];
  assert.equal(issued.status,'Sent');assert.equal(issued.email_message_id,null);
  assert.equal((await db.query("select count(*)::int n from hmp_client_messages where id=$1",[shared])).rows[0].n,1);
  await assert.rejects(db.query("update hmp_admin_invoices set total=200 where id=$1",[invoice]),/issued record is preserved/);
  console.log("Version registry verified: four kinds, immutable originals, cleared signatures/payments, idempotent retries, draft conflicts, retained archives, legacy proposals, same-link publication, stale-signing rejection, token rotation, recipient isolation, atomic proposal publication and denied public access.");
} finally {await db.close();}
