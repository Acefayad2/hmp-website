create table public.hmp_document_reminders (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('invoice','contract','form')),
 document_id uuid not null,
 conversation_id uuid not null references public.hmp_client_conversations(id) on delete cascade,
 due_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','sent','cancelled','failed')),
 created_by text not null, created_at timestamptz not null default now(),
 attempts integer not null default 0, claimed_at timestamptz, first_attempt_at timestamptz,
 email_payload jsonb, accepted_at timestamptz, portal_notice_at timestamptz, detail text,
 unique(kind,document_id,due_at)
);
alter table public.hmp_document_reminders enable row level security;
alter table public.hmp_document_reminders force row level security;
revoke all on public.hmp_document_reminders from public,anon,authenticated;
grant all on public.hmp_document_reminders to service_role;
create index hmp_document_reminders_due on public.hmp_document_reminders(due_at) where status='pending';
create function public.hmp_claim_document_reminders() returns setof public.hmp_document_reminders
language plpgsql security invoker set search_path=public as $$
begin
 update public.hmp_document_reminders set status='failed',detail='Automatic retries stopped; review delivery before scheduling another reminder.'
 where status='pending' and (attempts>=5 or first_attempt_at<now()-interval '23 hours') and (claimed_at is null or claimed_at<now()-interval '10 minutes');
 return query
 with due as (select id from public.hmp_document_reminders where status='pending' and due_at<=now()
 and attempts<5 and (claimed_at is null or claimed_at<now()-interval '10 minutes')
 order by due_at for update skip locked limit 5)
 update public.hmp_document_reminders r set attempts=attempts+1,claimed_at=now(),first_attempt_at=coalesce(first_attempt_at,now())
 from due where r.id=due.id returning r.*;
end $$;
revoke all on function public.hmp_claim_document_reminders() from public,anon,authenticated;
grant execute on function public.hmp_claim_document_reminders() to service_role;
