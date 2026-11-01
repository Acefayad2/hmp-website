// Run with a local PGlite installation; never connects to production.
// node scripts/check-hub-expiration.mjs /absolute/path/to/pglite/dist/index.js
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const {PGlite} = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table public.hmp_admin_inquiries(submission_id uuid primary key, celebration_date date, second_date date);
  create table public.hmp_client_conversations(
    id uuid primary key, inquiry_id uuid unique references public.hmp_admin_inquiries,
    token_nonce text not null, access_token_hash text not null, token_expires_at timestamptz not null,
    revoked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  alter table public.hmp_client_conversations enable row level security;
  grant all on public.hmp_admin_inquiries, public.hmp_client_conversations to service_role;
`);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
for (let n=1;n<=7;n++) await db.query("insert into hmp_admin_inquiries values ($1,$2,$3)",[id(n),n===4?null:"2026-10-25",n===3?"2026-11-04":null]);
const insert = (n,expiry) => db.query("insert into hmp_client_conversations values ($1,$1,'original','hash',$2,null,'2026-10-01T12:00:00Z','2026-10-01T12:00:00Z')",[id(n),expiry]);
await insert(1,"2027-10-01T12:00:00Z"); // Recognizable old automatic default.
await insert(2,"2027-11-01T03:59:59.999Z"); // Custom end-of-day, preserve.
await insert(3,"2027-10-02T09:13:00Z"); // Unknown provenance, preserve.
const row = async n => (await db.query("select * from hmp_client_conversations where id=$1",[id(n)])).rows[0];
const before = await row(1);
await db.exec(readFileSync(new URL("../supabase/migrations/20261101145910_client_hub_event_expiration.sql",import.meta.url),"utf8"));
assert.equal((await row(1)).token_expires_at.toISOString(),"2026-11-02T04:59:59.999Z");
assert.equal((await row(1)).expiration_mode,"event");
for (const key of ["token_nonce","access_token_hash","revoked_at"]) assert.equal((await row(1))[key],before[key]);
assert.equal((await row(2)).token_expires_at.toISOString(),"2027-11-01T03:59:59.999Z");
assert.equal((await row(3)).expiration_mode,"legacy");

// Same service role used by all five creation paths; no public privileges added.
await db.exec("set role service_role");
await db.query("insert into hmp_client_conversations(id,inquiry_id,token_nonce,access_token_hash,created_at) values ($1,$1,'nonce','hash','2026-10-25T12:00:00Z')",[id(4)]);
assert.equal((await row(4)).token_expires_at.toISOString(),"2026-11-02T04:59:59.999Z");
await db.query("update hmp_client_conversations set expiration_mode='event' where id=$1",[id(3)]);
assert.equal((await row(3)).token_expires_at.toISOString(),"2026-11-12T04:59:59.999Z");
await db.query("update hmp_admin_inquiries set second_date='2027-03-08' where submission_id=$1",[id(3)]);
assert.equal((await row(3)).token_expires_at.toISOString(),"2027-03-16T03:59:59.999Z");
await db.query("update hmp_client_conversations set expiration_mode='custom',token_expires_at='2028-02-02T04:59:59.999Z' where id=$1",[id(3)]);
await db.query("update hmp_admin_inquiries set second_date='2027-04-01' where submission_id=$1",[id(3)]);
assert.equal((await row(3)).token_expires_at.toISOString(),"2028-02-02T04:59:59.999Z");
// Renewal via upsert preserves the existing custom/unknown date, including old callers.
for (const n of [2,3]) {
  const original = (await row(n)).token_expires_at.toISOString();
  await db.query(`insert into hmp_client_conversations(id,inquiry_id,token_nonce,access_token_hash)
    values ($1,$1,'renewed','hash') on conflict(inquiry_id) do update set token_nonce=excluded.token_nonce,access_token_hash=excluded.access_token_hash`,[id(n)]);
  assert.equal((await row(n)).token_expires_at.toISOString(),original);
}
// Automatic renewal never adds another year or moves the event-based deadline.
await db.query("update hmp_client_conversations set token_nonce='renewed',token_expires_at='2099-01-01' where id=$1",[id(1)]);
assert.equal((await row(1)).token_expires_at.toISOString(),"2026-11-02T04:59:59.999Z");
await db.query("update hmp_client_conversations set token_expires_at='2027-05-02T03:59:59.999Z' where id=$1",[id(1)]);
assert.equal((await row(1)).expiration_mode,"custom","older Admin date picker is still honored");
await db.query("update hmp_client_conversations set expiration_mode='event' where id=$1",[id(1)]);
assert.equal((await row(1)).token_expires_at.toISOString(),"2026-11-02T04:59:59.999Z");
await db.query("update hmp_client_conversations set revoked_at=now() where id=$1",[id(1)]);
await db.query("update hmp_admin_inquiries set celebration_date='2026-12-01' where submission_id=$1",[id(1)]);
assert.ok((await row(1)).revoked_at,"rescheduling cannot reactivate revoked/archived access");
await db.exec("reset role");
const permissions = await db.query(`select has_table_privilege('anon','public.hmp_client_conversations','select') as readable,
  has_function_privilege('authenticated','public.hmp_hub_default_expiration(uuid,timestamp with time zone)','execute') as executable`);
assert.deepEqual(permissions.rows[0],{readable:false,executable:false});
await db.close();
console.log("PASS: migration backfill, preserved records, default/custom/legacy renewal, last event, missing date, DST, rescheduling and private access");
