-- Challenges are private to server-side Admin functions. No browser role can read codes.
create table if not exists public.hmp_admin_email_challenges (
  user_id text primary key,
  code_hash text,
  attempts integer not null default 0 check (attempts between 0 and 5),
  sent_at timestamptz not null,
  expires_at timestamptz not null,
  window_started_at timestamptz not null,
  sent_count integer not null default 1 check (sent_count between 1 and 5)
);

alter table public.hmp_admin_email_challenges enable row level security;
alter table public.hmp_admin_email_challenges force row level security;
revoke all on public.hmp_admin_email_challenges from anon, authenticated;
grant select, insert, update on public.hmp_admin_email_challenges to service_role;
