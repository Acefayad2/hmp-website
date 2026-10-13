-- Physical rows remain immutable once sent/completed. A revision is a new draft
-- in the same logical document group, so earlier links and signatures survive.
alter table public.hmp_admin_invoices
  add column if not exists revision_group_id uuid,
  add column if not exists revision_number integer not null default 1;
alter table public.hmp_admin_contracts
  add column if not exists revision_group_id uuid,
  add column if not exists revision_number integer not null default 1;
alter table public.hmp_client_agreements
  add column if not exists revision_group_id uuid,
  add column if not exists revision_number integer not null default 1;

create unique index if not exists hmp_invoice_revision_unique
  on public.hmp_admin_invoices (coalesce(revision_group_id, id), revision_number);
create unique index if not exists hmp_contract_revision_unique
  on public.hmp_admin_contracts (coalesce(revision_group_id, id), revision_number);
create unique index if not exists hmp_agreement_revision_unique
  on public.hmp_client_agreements (coalesce(revision_group_id, id), revision_number);

alter table public.hmp_admin_invoices
  add constraint hmp_invoice_revision_positive check (revision_number > 0);
alter table public.hmp_admin_contracts
  add constraint hmp_contract_revision_positive check (revision_number > 0);
alter table public.hmp_client_agreements
  add constraint hmp_agreement_revision_positive check (revision_number > 0);
