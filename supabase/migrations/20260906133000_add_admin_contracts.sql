create table if not exists public.hmp_admin_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null unique,
  status text not null default 'Draft' check (status in ('Draft', 'Sent', 'Signed', 'Void')),
  effective_date date not null,
  client_name text not null,
  client_email text not null,
  client_phone text,
  client_address text,
  event_name text,
  event_date date,
  event_location text,
  services text not null,
  scope_of_work text not null,
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  retainer_amount numeric(12,2) not null default 0 check (retainer_amount >= 0),
  payment_terms text,
  cancellation_terms text,
  additional_terms text,
  hmp_signature_name text,
  hmp_signed_at date,
  client_signature_name text,
  client_signed_at date,
  inquiry_id uuid references public.hmp_admin_inquiries(submission_id) on delete set null,
  sent_at timestamptz,
  sent_to text,
  email_message_id text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hmp_admin_contracts_created_idx
  on public.hmp_admin_contracts (created_at desc);
create index if not exists hmp_admin_contracts_client_email_idx
  on public.hmp_admin_contracts (client_email);
create index if not exists hmp_admin_contracts_event_date_idx
  on public.hmp_admin_contracts (event_date);
alter table public.hmp_admin_contracts enable row level security;
alter table public.hmp_admin_contracts force row level security;

revoke all on table public.hmp_admin_contracts from anon, authenticated;
grant all on table public.hmp_admin_contracts to service_role;

create policy "No direct API access to admin contracts"
  on public.hmp_admin_contracts
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
