-- Deleted reviews remain restorable for 30 days; archived reviews are retained.
alter table public.hmp_admin_reviews
  add column if not exists deleted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hmp_admin_reviews_one_inactive_state') then
    alter table public.hmp_admin_reviews
      add constraint hmp_admin_reviews_one_inactive_state
      check (archived_at is null or deleted_at is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hmp_admin_reviews_deleted_unpublished') then
    alter table public.hmp_admin_reviews
      add constraint hmp_admin_reviews_deleted_unpublished
      check (deleted_at is null or published = false);
  end if;
end $$;

comment on column public.hmp_admin_reviews.deleted_at is
  'Admin-only recoverable deletion. Permanently purged after 30 days.';

-- Put a client-facing copy in the PIN-protected conversation without sending email
-- or marking the original invoice/contract as emailed.
create or replace function public.hmp_record_shared_document(
  p_kind text, p_document_id uuid, p_conversation_id uuid, p_message_id uuid,
  p_snapshot jsonb, p_recipient text, p_sender text
) returns void language plpgsql security invoker set search_path = '' as $$
declare linked_inquiry uuid; conversation_inquiry uuid; document_email text; shared_at timestamptz := now();
begin
  if p_kind not in ('invoice','contract') or p_snapshot->>'kind' is distinct from p_kind
     or p_snapshot->>'id' is distinct from p_document_id::text then
    raise exception 'Invalid document';
  end if;
  if p_kind = 'invoice' then
    select inquiry_id, client_email into linked_inquiry, document_email
      from public.hmp_admin_invoices where id = p_document_id and archived_at is null and deleted_at is null
        and status <> 'Void' for update;
  else
    select inquiry_id, client_email into linked_inquiry, document_email
      from public.hmp_admin_contracts where id = p_document_id and status <> 'Void' for update;
  end if;
  select c.inquiry_id into conversation_inquiry from public.hmp_client_conversations c
    join public.hmp_admin_inquiries i on i.submission_id = c.inquiry_id
    where c.id = p_conversation_id and lower(trim(i.email)) = lower(trim(p_recipient))
      and c.revoked_at is null and c.token_expires_at > now();
  if linked_inquiry is null or conversation_inquiry is distinct from linked_inquiry
     or lower(trim(document_email)) is distinct from lower(trim(p_recipient)) then
    raise exception 'Document recipient does not match an active conversation';
  end if;
  if exists(select 1 from public.hmp_client_messages where id = p_message_id) then
    if not exists(select 1 from public.hmp_client_messages where id = p_message_id
        and conversation_id = p_conversation_id and document = p_snapshot) then
      raise exception 'Share request already used';
    end if;
    return;
  end if;
  insert into public.hmp_client_messages(id, conversation_id, sender, sender_name, body, document)
    values(p_message_id, p_conversation_id, 'admin', p_sender,
      initcap(p_kind) || ' ' || coalesce(p_snapshot->>'number','') || ' shared', p_snapshot);
  update public.hmp_client_conversations set last_message_at = shared_at,
    last_sender = 'admin', updated_at = shared_at where id = p_conversation_id;
end;
$$;
revoke all on function public.hmp_record_shared_document(text,uuid,uuid,uuid,jsonb,text,text)
  from public, anon, authenticated;
grant execute on function public.hmp_record_shared_document(text,uuid,uuid,uuid,jsonb,text,text)
  to service_role;
