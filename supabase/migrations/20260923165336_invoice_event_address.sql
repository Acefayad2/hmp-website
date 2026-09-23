-- Keep historical billing addresses intact; event locations are separate data.
alter table public.hmp_admin_invoices
  add column if not exists event_address text;

comment on column public.hmp_admin_invoices.event_address is
  'Event venue/address shown in the invoice editor and client invoice.';
