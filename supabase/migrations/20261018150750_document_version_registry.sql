-- A revision is a new document row, never an overwrite of a paid/signed original.
create table public.hmp_document_versions (
  kind text not null check (kind in ('invoice','contract','form','proposal')),
  document_id uuid not null,
  root_id uuid not null,
  version integer not null check (version>0),
  created_at timestamptz not null default now(),
  created_by text not null,
  primary key(kind,document_id),
  unique(kind,root_id,version)
);
alter table public.hmp_document_versions enable row level security;
revoke all on public.hmp_document_versions from public,anon,authenticated;
grant select,insert on public.hmp_document_versions to service_role;

-- These nullable pointers do not rewrite or re-sign existing records.
alter table public.hmp_admin_invoices add column revision_root_id uuid;
alter table public.hmp_admin_contracts add column revision_root_id uuid;
alter table public.hmp_admin_proposal_drafts add column revision_root_id uuid;
alter table public.hmp_client_agreements add column revision_root_id uuid;
alter table public.hmp_client_agreements add column prepared_snapshot jsonb;
alter table public.hmp_client_messages add column revision_root_id uuid;
alter table public.hmp_client_messages add column revision_document_id uuid;
create index hmp_agreement_revision_root on public.hmp_client_agreements(revision_root_id);

create function public.hmp_create_document_revision(
  p_kind text,p_source uuid,p_new_id uuid,p_nonce text,p_token_hash text,p_actor text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
  relation text;
  source jsonb;
  next_row jsonb;
  root uuid;
  next_version integer;
  latest_id uuid;
  latest jsonb;
begin
  relation:=case p_kind when 'invoice' then 'hmp_admin_invoices' when 'contract' then 'hmp_admin_contracts'
    when 'form' then 'hmp_client_agreements' when 'proposal' then 'hmp_admin_proposal_drafts' end;
  if relation is null or p_source is null or p_new_id is null or coalesce(p_actor,'')='' then
    raise exception 'Invalid document revision';
  end if;
  execute format('select to_jsonb(d) from public.%I d where id=$1',relation) into source using p_source;
  if source is null and p_kind='proposal' then
    select jsonb_build_object('id',m.id,'conversation_id',m.conversation_id,'payload',substring(m.body from 17)::jsonb,
      'sent_at',m.created_at,'sent_message_id',m.id,'created_at',m.created_at,'updated_at',m.created_at)
      into source from public.hmp_client_messages m where m.id=p_source and m.sender='admin' and m.deleted_at is null
      and left(m.body,16)='HMP_PROPOSAL_V1:';
    -- A sent draft's message is an alias, not a different revision family.
    select id into latest_id from public.hmp_admin_proposal_drafts where sent_message_id=p_source;
    if latest_id is not null then
      p_source:=latest_id;
      select to_jsonb(d) into source from public.hmp_admin_proposal_drafts d where id=p_source;
    end if;
  end if;
  if source is null then raise exception 'Document not found'; end if;
  select root_id into root from public.hmp_document_versions where kind=p_kind and document_id=p_source;
  root:=coalesce(root,p_source);
  perform pg_advisory_xact_lock(hashtextextended(p_kind||'/'||root::text,0));
  -- A repeated request must not create a second revision.
  if exists(select 1 from public.hmp_document_versions where kind=p_kind and document_id=p_new_id and root_id=root) then return p_new_id; end if;
  if not exists(select 1 from public.hmp_document_versions where kind=p_kind and document_id=p_source) then
    insert into public.hmp_document_versions(kind,document_id,root_id,version,created_by) values(p_kind,p_source,root,1,p_actor);
  end if;
  select document_id,version+1 into latest_id,next_version from public.hmp_document_versions
    where kind=p_kind and root_id=root order by version desc limit 1;
  execute format('select to_jsonb(d) from public.%I d where id=$1',relation) into latest using latest_id;
  if latest is not null and ((p_kind='proposal' and latest->>'sent_at' is null) or latest->>'status'='Draft') then
    raise exception 'An editable draft already exists. Open that draft before creating another revision.';
  end if;
  if source->>'status'='Void' or source->>'deleted_at' is not null or source->>'archived_at' is not null then
    raise exception 'Restore this document before creating a revision';
  end if;
  next_row:=source||jsonb_build_object('id',p_new_id,'revision_root_id',root,'status','Draft','created_by',p_actor,'created_at',now(),'updated_at',now(),
    'sent_at',null,'sent_to',null,'email_message_id',null,'archived_at',null,'deleted_at',null);
  if p_kind='invoice' then
    next_row:=next_row||jsonb_build_object('invoice_number',regexp_replace(source->>'invoice_number','(-R[0-9]+)+$','')||'-R'||next_version);
  elsif p_kind='contract' then
    next_row:=next_row||jsonb_build_object('contract_number',regexp_replace(source->>'contract_number','(-R[0-9]+)+$','')||'-R'||next_version,
      'client_signature_name',null,'client_signed_at',null,'hmp_signature_name',null,'hmp_signed_at',null);
  elsif p_kind='form' then
    if coalesce(length(p_nonce),0)<20 or coalesce(length(p_token_hash),0)<>64 then raise exception 'Invalid revision access token'; end if;
    next_row:=next_row||jsonb_build_object('token_nonce',p_nonce,'token_hash',p_token_hash,'client_answers','{}'::jsonb,
      'signature',null,'record_hash',null,'completed_at',null,'email_delivered_at',null,'expires_at',null,
      'snapshot',coalesce(nullif(source->'prepared_snapshot','null'::jsonb),source->'snapshot'),
      'admin_answers',coalesce(source->'admin_answers','{}'::jsonb)-'hmpSignedAt'-'hmpConsent');
  else
    next_row:=next_row||jsonb_build_object('sent_message_id',null);
  end if;
  execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I,$1)',relation,relation) using next_row;
  insert into public.hmp_document_versions(kind,document_id,root_id,version,created_by)
    values(p_kind,p_new_id,root,next_version,p_actor);
  return p_new_id;
end;
$$;
revoke all on function public.hmp_create_document_revision(text,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.hmp_create_document_revision(text,uuid,uuid,text,text,text) to service_role;

-- Keep recipients/event ownership fixed within a family, and preserve original
-- paid/signed content even if an old browser bypasses the new revision UI.
create function public.hmp_guard_document_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
declare before_row jsonb:=to_jsonb(old); after_row jsonb:=to_jsonb(new); root_row jsonb; root uuid; mutable text[]:=array['updated_at','sent_at','sent_to','email_message_id','archived_at','deleted_at','inquiry_id','status'];
begin
  if before_row->>'revision_root_id' is distinct from after_row->>'revision_root_id' then
    raise exception 'The revision family cannot be changed';
  end if;
  root:=(after_row->>'revision_root_id')::uuid;
  if tg_table_name='hmp_client_agreements' then
    perform pg_advisory_xact_lock(hashtextextended('form/'||coalesce(root,new.id)::text,0));
  end if;
  if root is not null then
    execute format('select to_jsonb(d) from public.%I d where id=$1',tg_table_name) into root_row using root;
    if tg_table_name='hmp_admin_proposal_drafts' and root_row is null then
      select jsonb_build_object('conversation_id',conversation_id) into root_row from public.hmp_client_messages where id=root;
    end if;
    if root_row is null then raise exception 'The original document is unavailable'; end if;
    if tg_table_name='hmp_admin_proposal_drafts' then
      if root_row->>'conversation_id' is distinct from after_row->>'conversation_id' then raise exception 'A revision must stay in the original client conversation'; end if;
    elsif lower(coalesce(root_row->>'client_email','')) is distinct from lower(coalesce(after_row->>'client_email',''))
       or root_row->>'inquiry_id' is distinct from after_row->>'inquiry_id' then
      raise exception 'A revision must keep the original client and event';
    end if;
  end if;
  if tg_table_name in ('hmp_admin_invoices','hmp_admin_contracts') and before_row->>'status' in ('Sent','Paid','Partially paid','Signed') then
    if tg_table_name='hmp_admin_contracts' and before_row->>'status'='Sent' then
      mutable:=mutable||array['client_signature_name','client_signed_at','hmp_signature_name','hmp_signed_at'];
    end if;
    if (before_row - mutable) is distinct from (after_row - mutable)
      or after_row->>'status'='Draft'
      or (before_row->>'status'='Paid' and after_row->>'status'<>'Paid')
      or (before_row->>'status'='Signed' and after_row->>'status'<>'Signed') then
      raise exception 'This issued record is preserved. Create a new revision to change its content.';
    end if;
  end if;
  if tg_table_name='hmp_admin_proposal_drafts' and old.sent_at is not null
    and (before_row->'payload' is distinct from after_row->'payload' or before_row->'conversation_id' is distinct from after_row->'conversation_id') then
    raise exception 'Sent proposals are preserved. Create a new revision.';
  end if;
  return new;
end;
$$;
revoke all on function public.hmp_guard_document_revision() from public,anon,authenticated;
grant execute on function public.hmp_guard_document_revision() to service_role;
create trigger hmp_invoice_revision_guard before update on public.hmp_admin_invoices for each row execute function public.hmp_guard_document_revision();
create trigger hmp_contract_revision_guard before update on public.hmp_admin_contracts for each row execute function public.hmp_guard_document_revision();
create trigger hmp_form_revision_guard before update on public.hmp_client_agreements for each row execute function public.hmp_guard_document_revision();
create trigger hmp_proposal_revision_guard before update on public.hmp_admin_proposal_drafts for each row execute function public.hmp_guard_document_revision();

-- Resolve only issued versions. Drafts can never be revealed by an old link.
create function public.hmp_resolve_agreement_revision(p_token_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare source public.hmp_client_agreements; target public.hmp_client_agreements; root uuid;
begin
  select * into source from public.hmp_client_agreements where token_hash=p_token_hash;
  if source.id is null or source.status not in ('Sent','Completed') then return null; end if;
  root:=coalesce(source.revision_root_id,source.id);
  select a.* into target from public.hmp_client_agreements a
    left join public.hmp_document_versions v on v.kind='form' and v.document_id=a.id
    where (a.id=root or a.revision_root_id=root) and a.status in ('Sent','Completed')
    order by coalesce(v.version,1) desc limit 1;
  if target.id is null or target.expires_at is null or target.expires_at<=now() then return null; end if;
  return to_jsonb(target);
end;
$$;
revoke all on function public.hmp_resolve_agreement_revision(text) from public,anon,authenticated;
grant execute on function public.hmp_resolve_agreement_revision(text) to service_role;

create function public.hmp_complete_agreement_revision(p_token_hash text,p_expected_id uuid,p_updated_at timestamptz,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare source public.hmp_client_agreements; target jsonb; saved public.hmp_client_agreements; root uuid;
begin
  select * into source from public.hmp_client_agreements where token_hash=p_token_hash for update;
  if source.id is null then return null; end if;
  root:=coalesce(source.revision_root_id,source.id);
  perform pg_advisory_xact_lock(hashtextextended('form/'||root::text,0));
  target:=public.hmp_resolve_agreement_revision(p_token_hash);
  if target is null or target->>'id'<>p_expected_id::text or target->>'status'<>'Sent' then return null; end if;
  update public.hmp_client_agreements set status='Completed',client_answers=p_payload->'client_answers',
    signature=nullif(p_payload->'signature','null'::jsonb),record_hash=p_payload->>'record_hash',
    completed_at=(p_payload->>'completed_at')::timestamptz,updated_at=(p_payload->>'updated_at')::timestamptz
    where id=p_expected_id and status='Sent' and updated_at=p_updated_at and expires_at>now() returning * into saved;
  if saved.id is null then return null; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.hmp_complete_agreement_revision(text,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.hmp_complete_agreement_revision(text,uuid,timestamptz,jsonb) to service_role;

create function public.hmp_mark_proposal_revision_sent(p_id uuid,p_message_id uuid,p_conversation_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare draft public.hmp_admin_proposal_drafts; message public.hmp_client_messages;
begin
  select * into draft from public.hmp_admin_proposal_drafts where id=p_id and conversation_id=p_conversation_id for update;
  select * into message from public.hmp_client_messages where id=p_message_id and conversation_id=p_conversation_id and sender='admin' and deleted_at is null for update;
  if draft.id is null or message.id is null or left(message.body,16)<>'HMP_PROPOSAL_V1:' then return false; end if;
  if draft.sent_at is not null then return draft.sent_message_id=p_message_id; end if;
  if draft.payload is distinct from substring(message.body from 17)::jsonb then return false; end if;
  update public.hmp_client_messages set revision_root_id=coalesce(draft.revision_root_id,draft.id),revision_document_id=draft.id where id=message.id;
  -- Backfill only the family identity of the original sent message, not its contents.
  update public.hmp_client_messages m set revision_root_id=coalesce(draft.revision_root_id,draft.id)
    from public.hmp_admin_proposal_drafts original
    where original.id=draft.revision_root_id and m.id=original.sent_message_id and m.conversation_id=p_conversation_id;
  update public.hmp_admin_proposal_drafts set sent_at=now(),sent_message_id=message.id where id=draft.id;
  return true;
end;
$$;
revoke all on function public.hmp_mark_proposal_revision_sent(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.hmp_mark_proposal_revision_sent(uuid,uuid,uuid) to service_role;

-- Sharing is an explicit publication too. Mark the draft issued atomically with
-- its client copy, so it cannot subsequently be overwritten as an unsent draft.
create or replace function public.hmp_record_shared_document(
  p_kind text,p_document_id uuid,p_conversation_id uuid,p_message_id uuid,
  p_snapshot jsonb,p_recipient text,p_sender text
) returns void language plpgsql security invoker set search_path='' as $$
declare linked_inquiry uuid; conversation_inquiry uuid; document_email text; shared_at timestamptz:=now();
begin
  if p_kind not in ('invoice','contract') or p_snapshot->>'kind' is distinct from p_kind or p_snapshot->>'id' is distinct from p_document_id::text then raise exception 'Invalid document'; end if;
  if p_kind='invoice' then
    select inquiry_id,client_email into linked_inquiry,document_email from public.hmp_admin_invoices
      where id=p_document_id and archived_at is null and deleted_at is null and status<>'Void' for update;
  else
    select inquiry_id,client_email into linked_inquiry,document_email from public.hmp_admin_contracts where id=p_document_id and status<>'Void' for update;
  end if;
  select c.inquiry_id into conversation_inquiry from public.hmp_client_conversations c join public.hmp_admin_inquiries i on i.submission_id=c.inquiry_id
    where c.id=p_conversation_id and lower(trim(i.email))=lower(trim(p_recipient)) and c.revoked_at is null and c.token_expires_at>now();
  if linked_inquiry is null or conversation_inquiry is distinct from linked_inquiry or lower(trim(document_email)) is distinct from lower(trim(p_recipient)) then raise exception 'Document recipient does not match an active conversation'; end if;
  if exists(select 1 from public.hmp_client_messages where id=p_message_id) then
    if not exists(select 1 from public.hmp_client_messages where id=p_message_id and conversation_id=p_conversation_id and document=p_snapshot) then raise exception 'Share request already used'; end if;
    return;
  end if;
  insert into public.hmp_client_messages(id,conversation_id,sender,sender_name,body,document)
    values(p_message_id,p_conversation_id,'admin',p_sender,initcap(p_kind)||' '||coalesce(p_snapshot->>'number','')||' shared',p_snapshot);
  if p_kind='invoice' then
    update public.hmp_admin_invoices set status=case when status='Draft' then 'Sent' else status end,sent_at=coalesce(sent_at,shared_at),updated_at=shared_at where id=p_document_id;
  else
    update public.hmp_admin_contracts set status=case when status='Draft' then 'Sent' else status end,sent_at=coalesce(sent_at,shared_at),updated_at=shared_at where id=p_document_id;
  end if;
  update public.hmp_client_conversations set last_message_at=shared_at,last_sender='admin',updated_at=shared_at where id=p_conversation_id;
end;
$$;
revoke all on function public.hmp_record_shared_document(text,uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.hmp_record_shared_document(text,uuid,uuid,uuid,jsonb,text,text) to service_role;
