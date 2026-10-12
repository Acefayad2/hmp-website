alter table public.hmp_client_agreements
  add column archived_at timestamptz,
  add column deleted_at timestamptz;

alter table public.hmp_client_agreements
  add constraint hmp_information_form_lifecycle_check
  check (archived_at is null or deleted_at is null);

create index hmp_client_agreements_deleted_idx
  on public.hmp_client_agreements (deleted_at)
  where deleted_at is not null;

-- Contracts remain immutable. Information-form content is also immutable once
-- completed; only its Admin filing state may change after completion.
create or replace function public.hmp_preserve_completed_agreement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'Completed' then
    if old.snapshot->>'kind' = 'information' and tg_op = 'DELETE'
       and old.deleted_at <= now() - interval '30 days' then
      return old;
    end if;
    if old.snapshot->>'kind' = 'information' and tg_op = 'UPDATE'
       and (to_jsonb(new) - 'archived_at' - 'deleted_at' - 'updated_at')
         = (to_jsonb(old) - 'archived_at' - 'deleted_at' - 'updated_at') then
      return new;
    end if;
    raise exception 'Completed agreements cannot be changed';
  end if;
  return coalesce(new, old);
end;
$$;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
  'hmp-purge-deleted-information-forms',
  '15 4 * * *',
  $$delete from public.hmp_client_agreements
    where snapshot->>'kind' = 'information'
      and deleted_at <= now() - interval '30 days'$$
);
