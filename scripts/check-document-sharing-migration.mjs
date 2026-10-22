// Uses a disposable in-memory Postgres instance, never production data.
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table hmp_client_messages(id int primary key, sender text, document jsonb);
    alter table hmp_client_messages enable row level security;
    grant select,insert on hmp_client_messages to service_role;
    alter table hmp_client_messages add constraint hmp_message_document_check check (document is null or (sender='admin' and document->>'kind' in ('invoice','contract','form','seating')));
    create table hmp_client_agreements(id int primary key, status text, expires_at timestamptz, snapshot jsonb, record_hash text);
    grant select,update on hmp_client_agreements to service_role;
    insert into hmp_client_messages values(1,'admin','{"kind":"invoice","total":100}');
    insert into hmp_client_agreements values(1,'Completed','2026-11-01','{"signed":"original"}','unchanged');`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261022202855_document_receipt_sharing.sql",import.meta.url),"utf8"));
  await db.exec("create trigger preserved before update or delete on hmp_client_agreements for each row execute function hmp_preserve_completed_agreement(); set role service_role;");
  await db.exec("insert into hmp_client_messages values(2,'admin','{\"kind\":\"receipt\"}');");
  await assert.rejects(()=>db.exec("insert into hmp_client_messages values(3,'client','{\"kind\":\"receipt\"}')"),/check constraint/);
  await assert.rejects(()=>db.exec("insert into hmp_client_messages values(3,'admin','{\"kind\":\"unknown\"}')"),/check constraint/);
  await db.exec("update hmp_client_agreements set expires_at='2026-11-02' where id=1");
  await assert.rejects(()=>db.exec("update hmp_client_agreements set snapshot='{}' where id=1"),/cannot be changed/);
  const original=(await db.query("select snapshot,record_hash from hmp_client_agreements where id=1")).rows[0];
  assert.deepEqual(original,{snapshot:{signed:"original"},record_hash:"unchanged"});
  for(const role of ["anon","authenticated"]){
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(()=>db.query("select * from hmp_client_messages"),/permission denied/);
  }
  console.log("PASS: receipt constraint, unchanged existing records, immutable signed content, expiration-only updates, private grants/RLS.");
} finally {await db.close();}
