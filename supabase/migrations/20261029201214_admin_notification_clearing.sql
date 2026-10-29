-- Personal dismissal only: retain the outbox, delivery status and signed records.
alter table public.hmp_admin_notifications
  add column cleared_by text[] not null default '{}';

create function public.hmp_clear_completion_notifications(p_ids uuid[], p_email text)
returns integer language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if p_email is null or btrim(p_email) = '' or p_ids is null
     or cardinality(p_ids) < 1 or cardinality(p_ids) > 100 then
    raise exception 'Invalid notification selection';
  end if;
  update public.hmp_admin_notifications
    set cleared_by = array_append(cleared_by, lower(btrim(p_email)))
    where id = any(p_ids) and not(lower(btrim(p_email)) = any(cleared_by));
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.hmp_clear_completion_notifications(uuid[],text) from public, anon, authenticated;
grant execute on function public.hmp_clear_completion_notifications(uuid[],text) to service_role;
