-- Archive is an Admin inbox state. Messages and the client's private link remain intact.
alter table public.hmp_client_conversations
  add column if not exists archived_at timestamptz;

create index if not exists hmp_client_conversations_archived_at_idx
  on public.hmp_client_conversations (archived_at)
  where archived_at is not null;

comment on column public.hmp_client_conversations.archived_at is
  'Admin inbox archive; a new client reply returns the conversation to the active inbox.';
