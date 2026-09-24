// Run with the absolute path to an installed PGlite module. No live data is used.
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table hmp_admin_inquiries(submission_id uuid primary key,email text);
    create table hmp_admin_invoices(id uuid primary key,inquiry_id uuid,client_email text,status text,sent_at timestamptz,sent_to text,email_message_id text,updated_at timestamptz);
    create table hmp_admin_contracts(like hmp_admin_invoices including all);
    grant all on hmp_admin_inquiries,hmp_admin_invoices,hmp_admin_contracts to service_role;`);
  for(const file of ["20260906120000_add_secure_client_conversations.sql","20260924004440_message_email_notifications.sql","20260924005355_sent_document_messages.sql"]){
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),"utf8"));
  }
  const id="11111111-1111-4111-8111-111111111111",inquiry="22222222-2222-4222-8222-222222222222",conversation="33333333-3333-4333-8333-333333333333",message="44444444-4444-4444-8444-444444444444";
  await db.query("insert into hmp_admin_inquiries values($1,'client@example.test')",[inquiry]);
  await db.query("insert into hmp_client_conversations(id,inquiry_id,access_token_hash,token_nonce,token_expires_at) values($1,$2,'hash','nonce','2099-01-01')",[conversation,inquiry]);
  for(const kind of ["invoice","contract"]){
    await db.query(`insert into hmp_admin_${kind}s(id,inquiry_id,client_email,status) values($1,$2,'client@example.test','Draft')`,[id,inquiry]);
  }
  await db.exec("set role service_role");
  const run=(kind="invoice",recipient="client@example.test",copy={kind,id,number:"HMP-1",total:900},messageId=message)=>db.query("select hmp_record_sent_document($1,$2,$3,$4,$5,$6,'email-id','HMP')",[kind,id,conversation,messageId,JSON.stringify(copy),recipient]);
  await assert.rejects(()=>run("invoice","wrong@example.test"),/does not match/);
  assert.equal((await db.query("select count(*)::int as n from hmp_client_messages")).rows[0].n,0);
  assert.equal((await db.query("select status from hmp_admin_invoices")).rows[0].status,"Draft");
  await run();await run();assert.equal((await db.query("select count(*)::int as n from hmp_client_messages")).rows[0].n,1);
  assert.equal((await db.query("select status from hmp_admin_invoices")).rows[0].status,"Sent");
  await assert.rejects(()=>run("invoice","client@example.test",{kind:"invoice",id,number:"Changed"}),/already used/);
  assert.equal((await db.query("select document->>'number' as n from hmp_client_messages")).rows[0].n,"HMP-1");
  await run("contract","client@example.test",{kind:"contract",id,number:"HMP-C-1"},"55555555-5555-4555-8555-555555555555");
  assert.equal((await db.query("select status from hmp_admin_contracts")).rows[0].status,"Sent");
  // The invoice status update fails after the insert: the entire RPC rolls back.
  await db.exec("reset role; alter table hmp_admin_invoices add constraint reject_test_recipient check(sent_to is distinct from 'client@example.test') not valid; set role service_role;");
  await assert.rejects(()=>run("invoice","client@example.test",{kind:"invoice",id,number:"Rollback"},"66666666-6666-4666-8666-666666666666"),/reject_test_recipient/);
  assert.equal((await db.query("select count(*)::int as n from hmp_client_messages")).rows[0].n,2);
  for(const role of ["anon","authenticated"]){
    await db.exec(`reset role; set role ${role};`);
    await assert.rejects(()=>db.query("select * from hmp_client_messages"),/permission denied/);
    await assert.rejects(()=>run(),/permission denied/);
  }
  console.log("Document migration passed: atomic status + snapshot, recipient isolation, stable retry, immutable sent copy, private table/RPC permissions.");
} finally {await db.close();}
