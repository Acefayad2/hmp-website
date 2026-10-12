-- Keep archived and deleted invoices recoverable without changing their billing status.
alter table public.hmp_admin_invoices
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hmp_admin_invoices_one_inactive_state') then
    alter table public.hmp_admin_invoices
      add constraint hmp_admin_invoices_one_inactive_state
      check (archived_at is null or deleted_at is null);
  end if;
end $$;

comment on column public.hmp_admin_invoices.archived_at is
  'Hidden from the active invoice list; restorable by an HMP admin.';
comment on column public.hmp_admin_invoices.deleted_at is
  'Recoverable deleted area; invoice and sent history are retained.';
