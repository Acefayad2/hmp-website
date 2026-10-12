-- One reusable HMP signature for messages, editable only through the admin API.
create table public.hmp_admin_message_signature (
  scope text primary key default 'hmp' check (scope = 'hmp'),
  body text not null default '' check (char_length(body) <= 1000),
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.hmp_admin_message_signature enable row level security;
revoke all on public.hmp_admin_message_signature from public, anon, authenticated;
grant select, insert, update on public.hmp_admin_message_signature to service_role;
