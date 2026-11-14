create table if not exists public.hmp_scheduled_client_messages (
  id uuid primary key,
  conversation_id uuid not null references public.hmp_client_conversations(id) on delete cascade,
  channel text not null check (channel in ('email','text')),
  body text not null check (char_length(body) between 1 and 4000),
  text_formatting jsonb not null default '[]'::jsonb,
  recipient text not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  created_by text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  detail text
);
create index if not exists hmp_scheduled_client_messages_due
  on public.hmp_scheduled_client_messages(scheduled_at) where status='pending';
create index if not exists hmp_scheduled_client_messages_conversation
  on public.hmp_scheduled_client_messages(conversation_id,created_at desc);
alter table public.hmp_scheduled_client_messages enable row level security;
revoke all on public.hmp_scheduled_client_messages from anon, authenticated;
grant select, insert, update on public.hmp_scheduled_client_messages to service_role;

create or replace function public.hmp_claim_scheduled_client_messages()
returns setof public.hmp_scheduled_client_messages
language plpgsql security invoker set search_path = public as $$
begin
  return query
  with due as (
    select id from public.hmp_scheduled_client_messages
    where status='pending' and scheduled_at<=now()
    order by scheduled_at limit 20 for update skip locked
  )
  update public.hmp_scheduled_client_messages m
    set status='processing', claimed_at=now()
  from due where m.id=due.id returning m.*;
end;
$$;
revoke all on function public.hmp_claim_scheduled_client_messages() from public, anon, authenticated;
grant execute on function public.hmp_claim_scheduled_client_messages() to service_role;
