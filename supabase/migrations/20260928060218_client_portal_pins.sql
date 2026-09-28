-- Shared infrastructure for the separately scoped messaging and seating links.
-- PIN hashes and rate-limit state are accessible only to server-side service_role.
create table public.hmp_client_portal_pins (
  id text primary key,
  pin_hash text,
  version uuid not null default gen_random_uuid(),
  attempts integer not null default 0,
  window_started_at timestamptz not null default now()
);
alter table public.hmp_client_portal_pins enable row level security;
revoke all on public.hmp_client_portal_pins from public, anon, authenticated;
grant select, insert, update, delete on public.hmp_client_portal_pins to service_role;

create function public.hmp_client_pin_attempt(p_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare permitted boolean;
begin
  if length(p_id) > 200 or p_id !~ '^(message|seating):[A-Za-z0-9_-]+:[a-f0-9]{64}$' then
    raise exception 'Invalid portal scope';
  end if;
  insert into public.hmp_client_portal_pins (id) values (p_id) on conflict (id) do nothing;
  update public.hmp_client_portal_pins
    set attempts = case when window_started_at <= now() - interval '15 minutes' then 1 else attempts + 1 end,
        window_started_at = case when window_started_at <= now() - interval '15 minutes' then now() else window_started_at end
    where id = p_id and (attempts < 10 or window_started_at <= now() - interval '15 minutes')
    returning true into permitted;
  return coalesce(permitted, false);
end;
$$;
revoke all on function public.hmp_client_pin_attempt(text) from public, anon, authenticated;
grant execute on function public.hmp_client_pin_attempt(text) to service_role;
