-- Private progress stays on the existing RLS-protected agreement row.
-- No signed records are rewritten and no browser roles gain database access.
begin;
set local lock_timeout='5s';
alter table public.hmp_client_agreements add column bank_progress jsonb;

create function public.hmp_bank_progress_lifecycle() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.bank_progress:=null; -- a revision never inherits another version's initials
  elsif old.status<>'Completed' and (new.status<>'Sent' or new.snapshot is distinct from old.snapshot or new.admin_answers is distinct from old.admin_answers) then
    new.bank_progress:=null;
  end if;
  return new;
end;
$$;
revoke all on function public.hmp_bank_progress_lifecycle() from public,anon,authenticated;
grant execute on function public.hmp_bank_progress_lifecycle() to service_role;
create trigger hmp_bank_progress_lifecycle before insert or update on public.hmp_client_agreements
for each row execute function public.hmp_bank_progress_lifecycle();

create function public.hmp_save_bank_progress(p_token_hash text,p_expected_id uuid,p_updated_at timestamptz,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare source public.hmp_client_agreements; target jsonb; saved public.hmp_client_agreements; root uuid; field jsonb; clean jsonb:='{}'; key text;
begin
  select * into source from public.hmp_client_agreements where token_hash=p_token_hash for update;
  if source.id is null then return null; end if;
  root:=coalesce(source.revision_root_id,source.id);
  perform pg_advisory_xact_lock(hashtextextended('form/'||root::text,0));
  target:=public.hmp_resolve_agreement_revision(p_token_hash);
  if target is null or target->>'id'<>p_expected_id::text or target->>'status'<>'Sent' or target->'snapshot'->>'id'<>'money-bank-verification' then return null; end if;
  if p_values is null or jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>200000 then raise exception 'Invalid draft progress'; end if;
  for field in select value from jsonb_array_elements(target->'snapshot'->'clientFields') loop
    key:=field->>'id';
    if key !~* 'signature|consent' and key not in ('representativeOneDate','representativeTwoDate','attendantDate') and p_values ? key then
      if jsonb_typeof(p_values->key)<>'string' or length(p_values->>key)>5000 then raise exception 'Invalid draft field'; end if;
      clean:=clean||jsonb_build_object(key,p_values->key);
    end if;
  end loop;
  update public.hmp_client_agreements set bank_progress=clean,updated_at=clock_timestamp()
    where id=p_expected_id and status='Sent' and updated_at=p_updated_at and expires_at>now() returning * into saved;
  if saved.id is null then return null; end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.hmp_save_bank_progress(text,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.hmp_save_bank_progress(text,uuid,timestamptz,jsonb) to service_role;
commit;
