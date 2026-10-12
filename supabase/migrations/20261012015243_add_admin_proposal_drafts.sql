create table public.hmp_admin_proposal_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.hmp_client_conversations(id) on delete cascade,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hmp_admin_proposal_drafts_conversation_idx
  on public.hmp_admin_proposal_drafts (conversation_id, updated_at desc);

alter table public.hmp_admin_proposal_drafts enable row level security;
alter table public.hmp_admin_proposal_drafts force row level security;
revoke all on table public.hmp_admin_proposal_drafts from anon, authenticated;
grant select, insert, update on table public.hmp_admin_proposal_drafts to service_role;
