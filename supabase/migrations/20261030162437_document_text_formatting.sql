begin;
set local lock_timeout='5s';
-- Metadata only. Existing text, signed records, privileges and RLS are untouched.
alter table public.hmp_admin_invoices add column text_formatting jsonb not null default '{}'::jsonb
  check (jsonb_typeof(text_formatting)='object' and octet_length(text_formatting::text)<=64000);
alter table public.hmp_admin_contracts add column text_formatting jsonb not null default '{}'::jsonb
  check (jsonb_typeof(text_formatting)='object' and octet_length(text_formatting::text)<=64000);
-- Proposals already use versioned JSON in message bodies. Allow bounded styling
-- metadata for Admin proposals only; normal/client messages remain capped at 4k.
alter table public.hmp_client_messages drop constraint hmp_client_messages_body_check;
alter table public.hmp_client_messages add constraint hmp_client_messages_body_check check (
  char_length(body)<=4000 or (sender='admin' and body like 'HMP_PROPOSAL_V1:%' and char_length(body)<=64000)
);
commit;
