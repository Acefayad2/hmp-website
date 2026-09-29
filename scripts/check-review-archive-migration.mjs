// Run against an isolated in-memory PostgreSQL database, never client data.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.hmp_admin_reviews(id uuid primary key default gen_random_uuid(), review_text text not null, published boolean not null default false);
    alter table public.hmp_admin_reviews enable row level security;
    grant select,insert,update on public.hmp_admin_reviews to service_role;
    insert into public.hmp_admin_reviews(review_text,published) values ('Preserve me',true);`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20260929233456_archive_admin_reviews.sql", import.meta.url), "utf8"));
  assert.equal((await db.query("select archived_at from public.hmp_admin_reviews")).rows[0].archived_at, null);
  await assert.rejects(() => db.exec("update public.hmp_admin_reviews set archived_at=now()"), /hmp_admin_reviews_archive_unpublished/);
  await db.exec("set role service_role; update public.hmp_admin_reviews set archived_at=now(),published=false;");
  assert.equal((await db.query("select count(*)::int as n from public.hmp_admin_reviews where archived_at is not null")).rows[0].n, 1);
  await assert.rejects(() => db.exec("update public.hmp_admin_reviews set published=true"), /hmp_admin_reviews_archive_unpublished/);
  await db.exec("update public.hmp_admin_reviews set archived_at=null,published=false;");
  assert.deepEqual((await db.query("select review_text,published,archived_at from public.hmp_admin_reviews")).rows[0], { review_text: "Preserve me", published: false, archived_at: null });
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(() => db.query("select * from public.hmp_admin_reviews"), /permission denied/);
  }
  console.log("Archive migration passed: existing rows preserved, archive unpublishes, constraint prevents republishing, restore preserves content, private permissions unchanged.");
} finally { await db.close(); }
