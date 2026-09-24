// Run with an installed PGlite module path; uses an isolated in-memory database.
// node scripts/check-review-request-migration.mjs /absolute/path/to/pglite/dist/index.js
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
if(!process.argv[2])throw new Error("Pass the installed PGlite module path.");
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
try {
  // Mirrors the existing review table's relevant columns, grants, and RLS.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.hmp_admin_reviews(id uuid primary key default gen_random_uuid(),reviewer_name text not null,reviewer_role text,review_text text not null,service text,rating smallint not null default 5,published boolean not null default true,is_placeholder boolean not null default false,display_order integer not null default 0,created_by text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    alter table public.hmp_admin_reviews enable row level security;
    grant select,insert,update,delete on public.hmp_admin_reviews to service_role;`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20260924003341_client_review_requests.sql",import.meta.url),"utf8"));
  await db.exec("set role service_role");
  const id="11111111-1111-4111-8111-111111111111";
  await db.query("insert into public.hmp_review_requests(id,client_name,client_email,token_hash,created_by) values ($1,'Test','test@example.test','hash','admin')",[id]);
  const input={reviewer_name:"Example Client",review_text:"Test review",rating:5,service:"Guest Seating Experience",published:true};
  const run=(body=input)=>db.query("select public.hmp_submit_requested_review('hash',$1::jsonb,'Permission to publish after approval') as id",[JSON.stringify(body)]);
  await assert.rejects(()=>run({...input,review_text:""}),/Invalid review/);
  assert.equal((await db.query("select submitted_at from public.hmp_review_requests")).rows[0].submitted_at,null);
  const first=await run(), second=await run();
  assert.equal(first.rows[0].id,second.rows[0].id);
  const rows=await db.query("select published,source_request_id from public.hmp_admin_reviews");
  assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].published,false);
  assert.equal(rows.rows[0].source_request_id,id);
  await db.query("delete from public.hmp_admin_reviews");
  await run();assert.equal((await db.query("select count(*)::int as n from public.hmp_admin_reviews")).rows[0].n,0);
  await db.query("update public.hmp_review_requests set expires_at='2000-01-01'");
  await assert.rejects(()=>run(),/no longer available/);
  await db.exec("reset role; set role anon;");
  await assert.rejects(()=>db.query("select * from public.hmp_review_requests"),/permission denied/);
  await assert.rejects(()=>run(),/permission denied/);
  await db.exec("reset role; set role authenticated;");
  await assert.rejects(()=>run(),/permission denied/);
  console.log("Review migration checks passed: unpublished submission, rollback, retry, expiry, no resurrection after decline, private table/RPC permissions.");
} finally {await db.close();}
