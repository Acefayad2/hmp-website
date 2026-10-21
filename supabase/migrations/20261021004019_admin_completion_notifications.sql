-- Private outbox: do not modify signed records or email historical completions.
create table public.hmp_admin_notifications (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null unique references public.hmp_client_agreements(id),
  client_name text not null,
  title text not null,
  kind text not null check (kind in ('form_completed','agreement_signed')),
  created_at timestamptz not null default now(),
  read_by text[] not null default '{}',
  email_accepted_at timestamptz,
  email_error text,
  email_from text,
  email_to text,
  first_attempt_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now()
);
alter table public.hmp_admin_notifications enable row level security;
revoke all on public.hmp_admin_notifications from public, anon, authenticated;
grant select,insert,update on public.hmp_admin_notifications to service_role;
create index hmp_admin_notifications_created_idx on public.hmp_admin_notifications(created_at desc);

create function public.hmp_queue_completion_notification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  insert into public.hmp_admin_notifications(agreement_id,client_name,title,kind,created_at)
  values(new.id,new.client_name,coalesce(new.snapshot->>'title','Client document'),
    case when new.signature is null then 'form_completed' else 'agreement_signed' end,
    coalesce(new.completed_at,now())) on conflict(agreement_id) do nothing;
  return new;
end;
$$;
revoke all on function public.hmp_queue_completion_notification() from public,anon,authenticated;
grant execute on function public.hmp_queue_completion_notification() to service_role;
create trigger hmp_queue_completion_notification after update of status on public.hmp_client_agreements
for each row when (new.status='Completed' and old.status is distinct from new.status)
execute function public.hmp_queue_completion_notification();

-- A lease and stable sender/recipient make retries safe across concurrent workers.
-- Stop automatic retries before the provider's 24-hour idempotency window ends.
create function public.hmp_claim_completion_notifications(p_from text,p_to text)
returns setof public.hmp_admin_notifications language sql security invoker set search_path='' as $$
  with pending as (
    select id from public.hmp_admin_notifications
    where email_accepted_at is null and attempts<5 and next_attempt_at<=now()
      and (first_attempt_at is null or first_attempt_at>now()-interval '23 hours')
    order by created_at limit 5 for update skip locked
  )
  update public.hmp_admin_notifications n
  set attempts=n.attempts+1,first_attempt_at=coalesce(n.first_attempt_at,now()),
    next_attempt_at=now()+interval '5 minutes',
    email_from=coalesce(n.email_from,p_from),email_to=coalesce(n.email_to,p_to)
  from pending where n.id=pending.id returning n.*;
$$;
revoke all on function public.hmp_claim_completion_notifications(text,text) from public,anon,authenticated;
grant execute on function public.hmp_claim_completion_notifications(text,text) to service_role;

create function public.hmp_read_completion_notification(p_id uuid,p_email text)
returns boolean language sql security invoker set search_path='' as $$
  with marked as (
    update public.hmp_admin_notifications set read_by=array_append(read_by,lower(p_email))
    where id=p_id and not(lower(p_email)=any(read_by)) returning id
  ) select exists(select 1 from public.hmp_admin_notifications where id=p_id);
$$;
revoke all on function public.hmp_read_completion_notification(uuid,text) from public,anon,authenticated;
grant execute on function public.hmp_read_completion_notification(uuid,text) to service_role;
