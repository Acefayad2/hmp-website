create table if not exists public.hmp_admin_proposal_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.hmp_client_conversations(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_message_id uuid
);

create index if not exists hmp_admin_proposal_drafts_active_idx
  on public.hmp_admin_proposal_drafts (updated_at desc) where sent_at is null;

alter table public.hmp_admin_proposal_drafts enable row level security;
revoke all on public.hmp_admin_proposal_drafts from anon, authenticated;
grant all on public.hmp_admin_proposal_drafts to service_role;
