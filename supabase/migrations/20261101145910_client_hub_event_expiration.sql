-- Legacy dates are preserved unless their timestamps identify the old automatic
-- 365-day default. Custom dates chosen in Admin are Eastern end-of-day values.
alter table public.hmp_client_conversations
  add column expiration_mode text not null default 'legacy'
  check (expiration_mode in ('event', 'custom', 'legacy'));
alter table public.hmp_client_conversations alter column expiration_mode set default 'event';

create function public.hmp_hub_default_expiration(p_inquiry_id uuid, p_created_at timestamptz)
returns timestamptz language sql stable security invoker set search_path = '' as $$
  select ((coalesce(greatest(i.celebration_date, i.second_date),
    (p_created_at at time zone 'America/New_York')::date) + 8)::timestamp
    at time zone 'America/New_York') - interval '1 millisecond'
  from public.hmp_admin_inquiries i where i.submission_id = p_inquiry_id;
$$;
revoke all on function public.hmp_hub_default_expiration(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.hmp_hub_default_expiration(uuid,timestamptz) to service_role;

create function public.hmp_set_hub_expiration()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- Compatibility while older Admin assets are open: their date picker updates
  -- only the deadline. Treat that deliberate edit as custom, not automatic.
  if TG_OP = 'UPDATE' and new.token_nonce is not distinct from old.token_nonce
    and new.expiration_mode = old.expiration_mode
    and new.token_expires_at is distinct from old.token_expires_at then
    new.expiration_mode := 'custom';
  end if;
  -- Renewing/resetting a link must not overwrite a deliberately saved date.
  if TG_OP = 'UPDATE' and new.token_nonce is distinct from old.token_nonce then
    new.expiration_mode := old.expiration_mode;
    if old.expiration_mode <> 'event' then new.token_expires_at := old.token_expires_at; end if;
  end if;
  if new.expiration_mode = 'event' then
    new.token_expires_at := public.hmp_hub_default_expiration(new.inquiry_id, new.created_at);
  end if;
  return new;
end;
$$;
revoke all on function public.hmp_set_hub_expiration() from public, anon, authenticated;
grant execute on function public.hmp_set_hub_expiration() to service_role;
create trigger hmp_set_hub_expiration
before insert or update of token_expires_at, token_nonce, expiration_mode, inquiry_id
on public.hmp_client_conversations for each row execute function public.hmp_set_hub_expiration();

create function public.hmp_refresh_hub_event_expiration()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  update public.hmp_client_conversations set expiration_mode = 'event'
  where inquiry_id = new.submission_id and expiration_mode = 'event';
  return new;
end;
$$;
revoke all on function public.hmp_refresh_hub_event_expiration() from public, anon, authenticated;
grant execute on function public.hmp_refresh_hub_event_expiration() to service_role;
create trigger hmp_refresh_hub_event_expiration
after update of celebration_date, second_date on public.hmp_admin_inquiries
for each row when (old.celebration_date is distinct from new.celebration_date or old.second_date is distinct from new.second_date)
execute function public.hmp_refresh_hub_event_expiration();

-- Deliberately conservative: unknown and end-of-day dates remain untouched.
-- Only access deadlines change; no tokens, PINs, messages or records are deleted.
update public.hmp_client_conversations set expiration_mode = 'event'
where (token_expires_at at time zone 'America/New_York')::time <> time '23:59:59.999'
  and (abs(extract(epoch from (token_expires_at-created_at)) - 31536000) < 5
    or abs(extract(epoch from (token_expires_at-updated_at)) - 31536000) < 5);
