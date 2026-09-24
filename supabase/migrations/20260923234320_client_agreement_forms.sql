create table public.hmp_client_agreements (
  id uuid primary key default gen_random_uuid(),
  template_id text not null,
  snapshot jsonb not null,
  client_name text not null,
  client_email text not null,
  admin_answers jsonb not null default '{}',
  client_answers jsonb not null default '{}',
  status text not null default 'Draft' check (status in ('Draft', 'Sent', 'Completed', 'Void')),
  token_nonce text not null,
  token_hash text unique not null,
  expires_at timestamptz,
  sent_at timestamptz,
  email_delivered_at timestamptz,
  completed_at timestamptz,
  signature jsonb,
  record_hash text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hmp_client_agreements enable row level security;
revoke all on public.hmp_client_agreements from public, anon, authenticated;
grant select, insert, update on public.hmp_client_agreements to service_role;
create index hmp_client_agreements_created_idx on public.hmp_client_agreements (created_at desc);

-- Signed records are append-only. To correct one, issue a separate agreement.
create function public.hmp_preserve_completed_agreement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'Completed' then
    raise exception 'Completed agreements cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function public.hmp_preserve_completed_agreement() from public, anon, authenticated;
create trigger hmp_preserve_completed_agreement before update or delete
on public.hmp_client_agreements for each row execute function public.hmp_preserve_completed_agreement();
