-- Preserve existing document records and the Admin-only document restriction.
-- New kinds are explicitly selected by Admin for a single inquiry.
begin;
set local lock_timeout = '5s';
alter table public.hmp_client_messages
  drop constraint hmp_message_document_check,
  add constraint hmp_message_document_check check (
    document is null or (
      sender = 'admin'
      and jsonb_typeof(document) = 'object'
      and (document ->> 'kind') in ('invoice', 'contract', 'form', 'seating')
    )
  );
commit;
