-- Staff texts sent through Quo. Service role only; no browser access.
create table public.hmp_sms_messages (
  id uuid primary key,
  request_id uuid not null unique,
  conversation_id uuid references public.hmp_client_conversations(id) on delete set null,
  inquiry_id uuid references public.hmp_admin_inquiries(submission_id) on delete set null,
  message_id uuid references public.hmp_client_messages(id) on delete set null,
  contact_name text,
  to_number text not null,
  from_number text not null,
  body text not null check (char_length(body) between 1 and 1600),
  provider_id text,
  status text not null check (status in ('pending', 'sent', 'failed')),
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hmp_sms_messages is 'Quo delivery log for staff texts. status sent means Quo accepted the message, not a handset receipt.';

alter table public.hmp_sms_messages enable row level security;
alter table public.hmp_sms_messages force row level security;
revoke all on table public.hmp_sms_messages from public, anon, authenticated;
grant select, insert, update on table public.hmp_sms_messages to service_role;

create index hmp_sms_messages_created_idx on public.hmp_sms_messages (created_at desc);
create index hmp_sms_messages_message_idx on public.hmp_sms_messages (message_id);
