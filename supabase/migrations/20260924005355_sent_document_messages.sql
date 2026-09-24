alter table public.hmp_client_messages add column document jsonb;
alter table public.hmp_client_messages add constraint hmp_message_document_check check (
  document is null or (sender = 'admin' and jsonb_typeof(document) = 'object' and document->>'kind' in ('invoice','contract'))
);

-- Save the sent copy and sent status together. Existing message RLS keeps it private.
create function public.hmp_record_sent_document(
  p_kind text, p_document_id uuid, p_conversation_id uuid, p_message_id uuid,
  p_snapshot jsonb, p_recipient text, p_email_id text, p_sender text
) returns void language plpgsql security invoker set search_path = public as $$
declare linked_inquiry uuid; conversation_inquiry uuid; document_email text; accepted_at timestamptz := now();
begin
  if p_kind not in ('invoice','contract') or p_snapshot->>'kind' is distinct from p_kind or p_snapshot->>'id' is distinct from p_document_id::text then
    raise exception 'Invalid document';
  end if;
  if p_kind = 'invoice' then
    select inquiry_id,client_email into linked_inquiry,document_email from public.hmp_admin_invoices where id=p_document_id for update;
  else
    select inquiry_id,client_email into linked_inquiry,document_email from public.hmp_admin_contracts where id=p_document_id for update;
  end if;
  select c.inquiry_id into conversation_inquiry from public.hmp_client_conversations c
    join public.hmp_admin_inquiries i on i.submission_id=c.inquiry_id
    where c.id=p_conversation_id and lower(trim(i.email))=lower(trim(p_recipient));
  if linked_inquiry is null or conversation_inquiry is distinct from linked_inquiry or lower(trim(document_email)) is distinct from lower(trim(p_recipient)) then
    raise exception 'Document recipient does not match conversation';
  end if;
  if exists(select 1 from public.hmp_client_messages where id=p_message_id) then
    if not exists(select 1 from public.hmp_client_messages where id=p_message_id and conversation_id=p_conversation_id and document=p_snapshot) then
      raise exception 'Send request already used';
    end if;
    return;
  end if;
  insert into public.hmp_client_messages(id,conversation_id,sender,sender_name,body,document,email_notified_at)
    values(p_message_id,p_conversation_id,'admin',p_sender,initcap(p_kind)||' '||coalesce(p_snapshot->>'number','')||' sent',p_snapshot,accepted_at);
  if p_kind='invoice' then
    update public.hmp_admin_invoices set status=case when status in ('Paid','Void') then status else 'Sent' end,
      sent_at=accepted_at,sent_to=p_recipient,email_message_id=p_email_id,updated_at=accepted_at where id=p_document_id;
  else
    update public.hmp_admin_contracts set status=case when status in ('Signed','Void') then status else 'Sent' end,
      sent_at=accepted_at,sent_to=p_recipient,email_message_id=p_email_id,updated_at=accepted_at where id=p_document_id;
  end if;
  update public.hmp_client_conversations set last_message_at=accepted_at,last_sender='admin',updated_at=accepted_at where id=p_conversation_id;
end;
$$;
revoke all on function public.hmp_record_sent_document(text,uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.hmp_record_sent_document(text,uuid,uuid,uuid,jsonb,text,text,text) to service_role;
