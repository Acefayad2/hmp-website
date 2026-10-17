// Run with an installed PGlite module path. Uses only synthetic, in-memory data.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const migration = async name => db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table hmp_admin_inquiries(submission_id uuid primary key,email text);
    create table hmp_admin_invoices(id uuid primary key,inquiry_id uuid,client_email text,status text,
      sent_at timestamptz,sent_to text,email_message_id text,updated_at timestamptz,
      constraint hmp_admin_invoices_status_check check(status in ('Draft','Sent','Paid','Void')));
    create table hmp_admin_contracts(like hmp_admin_invoices);
    grant all on hmp_admin_inquiries,hmp_admin_invoices,hmp_admin_contracts to service_role;`);
  for (const name of ["20260906120000_add_secure_client_conversations.sql", "20260924004440_message_email_notifications.sql", "20260924005355_sent_document_messages.sql",
    "20261017215020_admin_receipt_drafts.sql", "20261017215151_invoice_partial_payment_status.sql"]) await migration(name);
  const invoice = "11111111-1111-4111-8111-111111111111", inquiry = "22222222-2222-4222-8222-222222222222", conversation = "33333333-3333-4333-8333-333333333333";
  await db.query("insert into hmp_admin_inquiries values($1,'client@example.test')", [inquiry]);
  await db.query("insert into hmp_admin_invoices(id,inquiry_id,client_email,status) values($1,$2,'client@example.test','Partially paid')", [invoice, inquiry]);
  await db.query("insert into hmp_client_conversations(id,inquiry_id,access_token_hash,token_nonce,token_expires_at) values($1,$2,'hash','nonce','2099-01-01')", [conversation, inquiry]);
  await db.exec("set role service_role");
  const draft = (await db.query("insert into hmp_admin_receipt_drafts(invoice_id,payload,created_by) values($1,$2,'admin@example.test') returning *", [invoice, JSON.stringify({ amountPaid: "400.50", note: "Retainer" })])).rows[0];
  assert.equal(draft.revision, 1);
  assert.equal((await db.query("update hmp_admin_receipt_drafts set revision=revision+1 where id=$1 and revision=1 returning id", [draft.id])).rows.length, 1);
  assert.equal((await db.query("update hmp_admin_receipt_drafts set revision=revision+1 where id=$1 and revision=1 returning id", [draft.id])).rows.length, 0);
  for (const status of ["Partially paid", "Paid", "Void", "Draft"]) {
    await db.query("update hmp_admin_invoices set status=$1 where id=$2", [status, invoice]);
    await db.query("select hmp_record_sent_document('invoice',$1,$2,$3,$4,'client@example.test','email-id','HMP')", [invoice, conversation, crypto.randomUUID(), JSON.stringify({ kind: "invoice", id: invoice, number: "QA-1" })]);
    assert.equal((await db.query("select status from hmp_admin_invoices where id=$1", [invoice])).rows[0].status, status === "Draft" ? "Sent" : status);
  }
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(() => db.query("select * from hmp_admin_receipt_drafts"), /permission denied/);
    await assert.rejects(() => db.query("insert into hmp_admin_receipt_drafts(created_by) values('intruder')"), /permission denied/);
    await assert.rejects(() => db.query("select hmp_record_sent_document('invoice',$1,$2,$3,$4,'client@example.test','email-id','HMP')", [invoice, conversation, crypto.randomUUID(), JSON.stringify({ kind: "invoice", id: invoice })]), /permission denied/);
  }
  await db.exec("reset role");
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='hmp_admin_receipt_drafts'::regclass")).rows[0].relrowsecurity, true);
  await db.query("delete from hmp_admin_invoices where id=$1", [invoice]);
  assert.equal((await db.query("select invoice_id from hmp_admin_receipt_drafts where id=$1", [draft.id])).rows[0].invoice_id, null);
  console.log("Receipt migrations verified locally: draft CRUD, stale-save protection, private grants/RLS, retained draft after invoice removal, partial/full status survives sending.");
} finally { await db.close(); }
