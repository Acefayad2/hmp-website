-- Soft deletion revokes only the Client Hub. Independent documents stay intact.
alter table public.hmp_client_conversations
  add column deleted_at timestamptz,
  add column pre_delete_revoked_at timestamptz,
  add column purge_started_at timestamptz,
  add constraint hmp_deleted_hub_is_revoked check (deleted_at is null or revoked_at is not null);
create index hmp_deleted_hubs_due on public.hmp_client_conversations(deleted_at) where deleted_at is not null;

create function public.hmp_set_hub_deleted(p_id uuid,p_deleted boolean)
returns boolean language plpgsql security invoker set search_path=public as $$
declare r public.hmp_client_conversations%rowtype;
begin
  if p_deleted is null then raise exception 'Choose delete or restore'; end if;
  select * into r from public.hmp_client_conversations where id=p_id for update;
  if not found then return false; end if;
  if p_deleted and r.deleted_at is null then
    update public.hmp_client_conversations set deleted_at=now(),pre_delete_revoked_at=revoked_at,revoked_at=now(),updated_at=now() where id=p_id;
  elsif not p_deleted and r.deleted_at is not null then
    if r.purge_started_at is not null or r.deleted_at+interval '30 days'<=now() then raise exception 'The 30-day recovery period has ended'; end if;
    update public.hmp_client_conversations set deleted_at=null,revoked_at=pre_delete_revoked_at,pre_delete_revoked_at=null,updated_at=now() where id=p_id;
  end if;
  return true;
end;
$$;
revoke all on function public.hmp_set_hub_deleted(uuid,boolean) from public,anon,authenticated;
grant execute on function public.hmp_set_hub_deleted(uuid,boolean) to service_role;

-- Protect against old clients reactivating a deleted hub, including racing writes.
create function public.hmp_guard_deleted_hub() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.deleted_at is not null and (new.revoked_at is null or new.archived_at is distinct from old.archived_at) then
    raise exception 'Restore this hub from Deleted first';
  end if;
  return new;
end;
$$;
create trigger hmp_guard_deleted_hub before update on public.hmp_client_conversations for each row execute function public.hmp_guard_deleted_hub();
revoke all on function public.hmp_guard_deleted_hub() from public,anon,authenticated;
grant execute on function public.hmp_guard_deleted_hub() to service_role;

-- Serialize message/upload creation against deletion so no new files can arrive
-- after the cleanup worker has enumerated a deleted conversation's attachments.
create function public.hmp_guard_deleted_hub_content() returns trigger language plpgsql security invoker set search_path=public as $$
declare removed timestamptz;
begin
  select deleted_at into removed from public.hmp_client_conversations where id=new.conversation_id for update;
  if removed is not null then raise exception 'Restore this hub from Deleted before making changes'; end if;
  return new;
end;
$$;
create trigger hmp_deleted_hub_message_guard before insert or update on public.hmp_client_messages for each row execute function public.hmp_guard_deleted_hub_content();
create trigger hmp_deleted_hub_upload_guard before insert on public.hmp_conversation_attachment_uploads for each row execute function public.hmp_guard_deleted_hub_content();
revoke all on function public.hmp_guard_deleted_hub_content() from public,anon,authenticated;
grant execute on function public.hmp_guard_deleted_hub_content() to service_role;
