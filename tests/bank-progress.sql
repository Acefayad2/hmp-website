-- Disposable database only. Synthetic records; never run on production.
begin;
insert into public.hmp_client_agreements(id,template_id,snapshot,client_name,client_email,token_nonce,token_hash,created_by,status,expires_at,updated_at)
values ('11111111-1111-4111-8111-111111111111','money-bank-verification','{"id":"money-bank-verification","clientFields":[{"id":"receivedInitials"},{"id":"actualBank"},{"id":"representativeOneSignature"},{"id":"attendantDate"}]}','Synthetic','test@example.test','seed','testhash','test','Sent','2099-01-01','2026-01-01');
do $$
declare saved jsonb; before_row jsonb;
begin
  saved:=public.hmp_save_bank_progress('testhash','11111111-1111-4111-8111-111111111111','2026-01-01','{"receivedInitials":"AB","actualBank":"250","representativeOneSignature":"NO","attendantDate":"2026-10-29","consent":true}');
  if saved->'bank_progress'<>'{"receivedInitials":"AB","actualBank":"250"}'::jsonb then raise exception 'Field filtering failed'; end if;
  if saved->>'status'<>'Sent' or saved->>'signature' is not null or saved->>'completed_at' is not null then raise exception 'Draft became signed'; end if;
  if public.hmp_save_bank_progress('testhash','11111111-1111-4111-8111-111111111111','2026-01-01','{}') is not null then raise exception 'Stale save accepted'; end if;
  if public.hmp_save_bank_progress('wronghash','11111111-1111-4111-8111-111111111111',(saved->>'updated_at')::timestamptz,'{}') is not null then raise exception 'Wrong token accepted'; end if;
  if has_function_privilege('anon','public.hmp_save_bank_progress(text,uuid,timestamptz,jsonb)','execute') or has_function_privilege('authenticated','public.hmp_save_bank_progress(text,uuid,timestamptz,jsonb)','execute') then raise exception 'Public execution allowed'; end if;
  if not has_function_privilege('service_role','public.hmp_save_bank_progress(text,uuid,timestamptz,jsonb)','execute') then raise exception 'Missing service permission'; end if;
  if has_table_privilege('anon','public.hmp_client_agreements','select') then raise exception 'Drafts exposed'; end if;
  update public.hmp_client_agreements set expires_at='2000-01-01' where id='11111111-1111-4111-8111-111111111111';
  if public.hmp_save_bank_progress('testhash','11111111-1111-4111-8111-111111111111',(saved->>'updated_at')::timestamptz,'{}') is not null then raise exception 'Expired draft accepted'; end if;
  update public.hmp_client_agreements set expires_at='2099-01-01',status='Completed',signature='{"name":"Synthetic signer"}',record_hash='original' where id='11111111-1111-4111-8111-111111111111';
  select to_jsonb(a) into before_row from public.hmp_client_agreements a where id='11111111-1111-4111-8111-111111111111';
  if before_row->'bank_progress'<>'null'::jsonb then raise exception 'Completed draft not cleared'; end if;
  if public.hmp_save_bank_progress('testhash','11111111-1111-4111-8111-111111111111',(saved->>'updated_at')::timestamptz,'{}') is not null then raise exception 'Completed draft accepted'; end if;
  if before_row is distinct from (select to_jsonb(a) from public.hmp_client_agreements a where id='11111111-1111-4111-8111-111111111111') then raise exception 'Signed original changed'; end if;
end;
$$;
rollback;
