-- Additive lifecycle state. Existing portal links and documents are unchanged.
alter table public.hmp_client_conversations
  add column archived_at timestamptz,
  add column pre_archive_revoked_at timestamptz,
  add constraint hmp_archived_hub_is_revoked check (archived_at is null or revoked_at is not null);

create function public.hmp_set_hub_archived(p_id uuid, p_archived boolean)
returns boolean language plpgsql security invoker set search_path = public as $$
declare current_row public.hmp_client_conversations%rowtype;
begin
  if p_archived is null then raise exception 'Choose archive or restore'; end if;
  select * into current_row from public.hmp_client_conversations where id=p_id for update;
  if not found then return false; end if;
  if p_archived and current_row.archived_at is null then
    update public.hmp_client_conversations
      set archived_at=now(), pre_archive_revoked_at=revoked_at, revoked_at=now(), updated_at=now()
      where id=p_id;
  elsif not p_archived and current_row.archived_at is not null then
    update public.hmp_client_conversations
      set archived_at=null, revoked_at=pre_archive_revoked_at, pre_archive_revoked_at=null, updated_at=now()
      where id=p_id;
  end if;
  return true;
end;
$$;
revoke all on function public.hmp_set_hub_archived(uuid,boolean) from public,anon,authenticated;
grant execute on function public.hmp_set_hub_archived(uuid,boolean) to service_role;
