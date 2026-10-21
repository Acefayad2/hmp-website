-- Run after the migration inside a transaction; always ROLLBACK the entire test.
do $$
declare v_id uuid:=gen_random_uuid(); v_signed uuid:=gen_random_uuid(); v_notification uuid; v_count integer;
begin
  insert into public.hmp_client_agreements(id,template_id,snapshot,client_name,client_email,status,token_nonce,token_hash,created_by)
  values(v_id,'qa-notification','{"title":"Synthetic notification QA"}','Synthetic QA','qa@example.test','Sent',v_id::text,v_id::text,'qa@example.test');
  if exists(select 1 from public.hmp_admin_notifications where agreement_id=v_id) then raise exception 'Sent draft notified'; end if;
  update public.hmp_client_agreements set status='Completed',completed_at=now() where id=v_id;
  select id into v_notification from public.hmp_admin_notifications where agreement_id=v_id and kind='form_completed';
  if v_notification is null then raise exception 'Missing completion notification'; end if;
  perform public.hmp_read_completion_notification(v_notification,'Admin@Example.test');
  perform public.hmp_read_completion_notification(v_notification,'admin@example.test');
  perform public.hmp_read_completion_notification(v_notification,'second@example.test');
  select cardinality(read_by) into v_count from public.hmp_admin_notifications where id=v_notification;
  if v_count<>2 then raise exception 'Read state not deduplicated per user'; end if;
  perform public.hmp_claim_completion_notifications('sender@example.test','alerts@example.test');
  if not exists(select 1 from public.hmp_admin_notifications where id=v_notification and attempts=1 and email_to='alerts@example.test') then raise exception 'Claim failed'; end if;
  perform public.hmp_claim_completion_notifications('changed@example.test','changed@example.test');
  if exists(select 1 from public.hmp_admin_notifications where id=v_notification and attempts<>1) then raise exception 'Lease did not prevent duplicate claim'; end if;
  update public.hmp_admin_notifications set next_attempt_at=now()-interval '1 minute' where id=v_notification;
  perform public.hmp_claim_completion_notifications('changed@example.test','changed@example.test');
  if not exists(select 1 from public.hmp_admin_notifications where id=v_notification and attempts=2 and email_to='alerts@example.test') then raise exception 'Retry changed recipient'; end if;
  update public.hmp_admin_notifications set next_attempt_at=now()-interval '1 minute',first_attempt_at=now()-interval '24 hours' where id=v_notification;
  perform public.hmp_claim_completion_notifications('changed@example.test','changed@example.test');
  if exists(select 1 from public.hmp_admin_notifications where id=v_notification and attempts<>2) then raise exception 'Expired idempotency window retried'; end if;
  update public.hmp_admin_notifications set attempts=5,first_attempt_at=now(),next_attempt_at=now()-interval '1 minute' where id=v_notification;
  perform public.hmp_claim_completion_notifications('sender@example.test','alerts@example.test');
  if exists(select 1 from public.hmp_admin_notifications where id=v_notification and attempts<>5) then raise exception 'Attempt limit exceeded'; end if;
  insert into public.hmp_client_agreements(id,template_id,snapshot,client_name,client_email,status,token_nonce,token_hash,created_by)
  values(v_signed,'qa-notification','{"title":"Synthetic signature QA"}','Synthetic QA','qa@example.test','Sent',v_signed::text,v_signed::text,'qa@example.test');
  update public.hmp_client_agreements set status='Completed',completed_at=now(),signature='{"name":"Synthetic QA"}' where id=v_signed;
  if not exists(select 1 from public.hmp_admin_notifications where agreement_id=v_signed and kind='agreement_signed') then raise exception 'Signature notification missing'; end if;
  if (select count(*) from public.hmp_admin_notifications where agreement_id=v_signed)<>1 then raise exception 'Duplicate notification'; end if;
  if has_table_privilege('anon','public.hmp_admin_notifications','SELECT') or has_table_privilege('authenticated','public.hmp_admin_notifications','SELECT') then raise exception 'Notifications exposed'; end if;
  if has_function_privilege('anon','public.hmp_claim_completion_notifications(text,text)','EXECUTE') then raise exception 'Claim exposed'; end if;
end $$;
