begin;
create table public.hmp_admin_receipt_drafts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.hmp_admin_invoices(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hmp_admin_receipt_drafts_updated_idx on public.hmp_admin_receipt_drafts(updated_at desc);
create index hmp_admin_receipt_drafts_invoice_idx on public.hmp_admin_receipt_drafts(invoice_id);
alter table public.hmp_admin_receipt_drafts enable row level security;
revoke all on public.hmp_admin_receipt_drafts from public, anon, authenticated;
grant select, insert, update on public.hmp_admin_receipt_drafts to service_role;
commit;
