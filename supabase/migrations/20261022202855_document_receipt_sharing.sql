begin;
set local lock_timeout = '5s';
-- Receipts are immutable client copies in the existing private message store.
-- No grants, policies, existing records, or payment states are changed.
alter table public.hmp_client_messages drop constraint hmp_message_document_check;
alter table public.hmp_client_messages add constraint hmp_message_document_check check (
  document is null or (sender = 'admin' and jsonb_typeof(document) = 'object'
    and document->>'kind' in ('invoice','contract','form','seating','receipt'))
);
-- The signed payload, signatures, timestamps and hash remain immutable. Only
-- link-access expiration may be changed by the existing protected Admin API.
create or replace function public.hmp_preserve_completed_agreement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'Completed' then
    if tg_op = 'DELETE' then raise exception 'Completed agreements cannot be deleted'; end if;
    if (to_jsonb(old) - 'expires_at') is distinct from (to_jsonb(new) - 'expires_at') then
      raise exception 'Completed agreements cannot be changed';
    end if;
  end if;
  return new;
end;
$$;
commit;
