import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table hmp_admin_inquiries(submission_id uuid primary key);
    grant all on hmp_admin_inquiries to service_role;`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20260906120000_add_secure_client_conversations.sql",import.meta.url),"utf8"));
  const id="11111111-1111-4111-8111-111111111111";
  await db.query("insert into hmp_admin_inquiries values($1)",[id]);
  await db.query("insert into hmp_client_conversations(id,inquiry_id,access_token_hash,token_nonce,token_expires_at) values($1,$1,'hash','nonce','2099-01-01')",[id]);
  await db.query("insert into hmp_client_messages(conversation_id,sender,body) values($1,'admin','Preserved message')",[id]);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261030161616_client_hub_archive.sql",import.meta.url),"utf8"));
  const row=async()=>(await db.query("select * from hmp_client_conversations where id=$1",[id])).rows[0];
  const original=await row();
  assert.equal(original.archived_at,null);
  await db.exec("set role service_role");
  const change=archived=>db.query("select hmp_set_hub_archived($1,$2) as ok",[id,archived]);
  await change(true);
  const archived=await row();
  assert.ok(archived.archived_at);assert.ok(archived.revoked_at);
  for(const key of ["access_token_hash","token_nonce","token_expires_at"])assert.deepEqual(archived[key],original[key]);
  await change(true);assert.deepEqual(await row(),archived);
  await assert.rejects(()=>db.query("update hmp_client_conversations set revoked_at=null where id=$1",[id]),/hmp_archived_hub_is_revoked/);
  await change(false);
  assert.equal((await row()).revoked_at,null);
  assert.equal((await row()).archived_at,null);
  assert.equal((await db.query("select body from hmp_client_messages")).rows[0].body,"Preserved message");
  await db.query("update hmp_client_conversations set revoked_at='2020-01-01', token_expires_at='2020-02-01' where id=$1",[id]);
  const inactive=await row();
  await change(true);await change(false);
  assert.deepEqual((await row()).revoked_at,inactive.revoked_at);
  assert.deepEqual((await row()).token_expires_at,inactive.token_expires_at);
  assert.equal((await db.query("select hmp_set_hub_archived('22222222-2222-4222-8222-222222222222',true) as ok")).rows[0].ok,false);
  for(const role of ["anon","authenticated"]){
    await db.exec(`reset role;set role ${role}`);
    await assert.rejects(()=>change(true),/permission denied/);
    await assert.rejects(()=>row(),/permission denied/);
  }
  console.log("PASS: additive archive, preserved messages/tokens/expiration, idempotence, archive cannot reactivate, expired/revoked restoration, service-only access.");
} finally {await db.close();}
