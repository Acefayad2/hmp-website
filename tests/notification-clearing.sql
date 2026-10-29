-- Run against a disposable database with the notification schema and migration.
begin;
do $$
declare
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  later_id uuid := gen_random_uuid();
  agreement uuid := gen_random_uuid();
  original jsonb;
begin
  insert into public.hmp_client_agreements(id) values(agreement);
  insert into public.hmp_admin_notifications(id,agreement_id,client_name,title,kind,attempts,email_error)
    values(first_id,agreement,'Synthetic QA','Synthetic form','form_completed',2,'Synthetic retry');
  select to_jsonb(n)-'cleared_by' into original from public.hmp_admin_notifications n where id=first_id;
  if public.hmp_clear_completion_notifications(array[first_id],'ADMIN@example.test')<>1 then raise exception 'Initial clear failed'; end if;
  if public.hmp_clear_completion_notifications(array[first_id],'admin@example.test')<>0 then raise exception 'Clear is not idempotent'; end if;
  if (select to_jsonb(n)-'cleared_by' from public.hmp_admin_notifications n where id=first_id) is distinct from original then raise exception 'History or delivery changed'; end if;
  if not exists(select 1 from public.hmp_admin_notifications where id=first_id and 'admin@example.test'=any(cleared_by) and not('second@example.test'=any(cleared_by))) then raise exception 'Account isolation failed'; end if;
  if public.hmp_clear_completion_notifications(array[first_id],'second@example.test')<>1 then raise exception 'Second admin clear failed'; end if;
  if (select cardinality(cleared_by) from public.hmp_admin_notifications where id=first_id)<>2 then raise exception 'Readers lost'; end if;
  insert into public.hmp_client_agreements(id) values(second_id),(later_id);
  insert into public.hmp_admin_notifications(id,agreement_id,client_name,title,kind)
    values(second_id,second_id,'Synthetic QA','Second','form_completed'),(later_id,later_id,'Synthetic QA','Later','agreement_signed');
  perform public.hmp_clear_completion_notifications(array[first_id,second_id],'admin@example.test');
  if (select cardinality(cleared_by) from public.hmp_admin_notifications where id=later_id)<>0 then raise exception 'New notification cleared unexpectedly'; end if;
  if not exists(select 1 from public.hmp_client_agreements where id=agreement) then raise exception 'Document removed'; end if;
  if has_function_privilege('anon','public.hmp_clear_completion_notifications(uuid[],text)','execute') or has_function_privilege('authenticated','public.hmp_clear_completion_notifications(uuid[],text)','execute') then raise exception 'Public mutation access'; end if;
  if not has_function_privilege('service_role','public.hmp_clear_completion_notifications(uuid[],text)','execute') then raise exception 'Server access missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.hmp_admin_notifications'::regclass) then raise exception 'RLS lost'; end if;
  if has_table_privilege('anon','public.hmp_admin_notifications','select') or has_table_privilege('authenticated','public.hmp_admin_notifications','select') then raise exception 'History exposed'; end if;
  begin
    perform public.hmp_clear_completion_notifications(array[]::uuid[],'admin@example.test');
    raise exception 'Empty selection accepted';
  exception when raise_exception then
    if sqlerrm<>'Invalid notification selection' then raise; end if;
  end;
end;
$$;
rollback;
