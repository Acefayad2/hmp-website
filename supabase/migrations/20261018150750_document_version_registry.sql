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
  execute format('select to_jsonb(d) from public.%I d where id=$1 for update',relation) into source using p_source;
  if source is null and p_kind='proposal' then
    select jsonb_build_object('id',m.id,'conversation_id',m.conversation_id,'payload',substring(m.body from 17)::jsonb,
      'sent_at',m.created_at,'sent_message_id',m.id,'created_at',m.created_at,'updated_at',m.created_at)
      into source from public.hmp_client_messages m where m.id=p_source and m.sender='admin' and m.deleted_at is null
      and left(m.body,16)='HMP_PROPOSAL_V1:';
  end if;
  if source is null then raise exception 'Document not found'; end if;
  select root_id into root from public.hmp_document_versions where kind=p_kind and document_id=p_source;
  root:=coalesce(root,p_source);
  perform pg_advisory_xact_lock(hashtextextended(p_kind||'/'||root::text,0));
  -- A repeated request must not create a second revision.
  if exists(select 1 from public.hmp_document_versions where kind=p_kind and document_id=p_new_id and root_id=root) then return p_new_id; end if;
  insert into public.hmp_document_versions(kind,document_id,root_id,version,created_by)
    values(p_kind,p_source,root,1,p_actor) on conflict(kind,document_id) do nothing;
  select document_id,version+1 into latest_id,next_version from public.hmp_document_versions
    where kind=p_kind and root_id=root order by version desc limit 1;
  execute format('select to_jsonb(d) from public.%I d where id=$1',relation) into latest using latest_id;
  if latest is not null and ((p_kind='proposal' and latest->>'sent_at' is null) or latest->>'status'='Draft') then
    raise exception 'An editable draft already exists. Open that draft before creating another revision.';
  end if;
  if source->>'status'='Void' or source->>'deleted_at' is not null or source->>'archived_at' is not null then
    raise exception 'Restore this document before creating a revision';
  end if;
  next_row:=source||jsonb_build_object('id',p_new_id,'status','Draft','created_by',p_actor,'created_at',now(),'updated_at',now(),
    'sent_at',null,'sent_to',null,'email_message_id',null,'archived_at',null,'deleted_at',null);
  if p_kind='invoice' then
    next_row:=next_row||jsonb_build_object('invoice_number',(source->>'invoice_number')||'-R'||next_version);
  elsif p_kind='contract' then
    next_row:=next_row||jsonb_build_object('contract_number',(source->>'contract_number')||'-R'||next_version,
      'client_signature_name',null,'client_signed_at',null,'hmp_signature_name',null,'hmp_signed_at',null);
  elsif p_kind='form' then
    if coalesce(length(p_nonce),0)<20 or coalesce(length(p_token_hash),0)<>64 then raise exception 'Invalid revision access token'; end if;
    next_row:=next_row||jsonb_build_object('token_nonce',p_nonce,'token_hash',p_token_hash,'client_answers','{}'::jsonb,
      'signature',null,'record_hash',null,'completed_at',null,'email_delivered_at',null,'expires_at',null,
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
