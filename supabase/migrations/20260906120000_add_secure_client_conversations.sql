create table if not exists public.hmp_client_conversations (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null unique references public.hmp_admin_inquiries(submission_id) on delete cascade,
  access_token_hash text not null unique,
  token_nonce text not null,
  token_expires_at timestamptz not null,
  revoked_at timestamptz,
  last_message_at timestamptz,
  last_sender text check (last_sender is null or last_sender in ('client', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hmp_client_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.hmp_client_conversations(id) on delete cascade,
  sender text not null check (sender in ('client', 'admin')),
  sender_name text,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists hmp_client_conversations_last_message_idx
  on public.hmp_client_conversations (last_message_at desc nulls last);
create index if not exists hmp_client_messages_conversation_created_idx
  on public.hmp_client_messages (conversation_id, created_at asc);
create index if not exists hmp_client_messages_rate_limit_idx
  on public.hmp_client_messages (conversation_id, sender, created_at desc);

alter table public.hmp_client_conversations enable row level security;
alter table public.hmp_client_messages enable row level security;
alter table public.hmp_client_conversations force row level security;
alter table public.hmp_client_messages force row level security;

revoke all on table public.hmp_client_conversations from anon, authenticated;
revoke all on table public.hmp_client_messages from anon, authenticated;
grant all on table public.hmp_client_conversations to service_role;
grant all on table public.hmp_client_messages to service_role;
