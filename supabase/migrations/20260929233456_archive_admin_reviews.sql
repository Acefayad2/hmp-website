-- Preserve declined reviews privately instead of removing the client record.
alter table public.hmp_admin_reviews
  add column archived_at timestamptz;

alter table public.hmp_admin_reviews
  add constraint hmp_admin_reviews_archive_unpublished
  check (archived_at is null or published = false);

comment on column public.hmp_admin_reviews.archived_at is
  'Admin-only review archive. Restore as unpublished before approving again.';
