create table public.hmp_review_requests (
  id uuid primary key,
  client_name text not null check (length(client_name) between 1 and 120),
  client_email text not null check (length(client_email) between 3 and 320),
  token_hash text not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  email_delivered_at timestamptz,
  submitted_at timestamptz,
  consent_text text
);
alter table public.hmp_review_requests enable row level security;
revoke all on public.hmp_review_requests from public, anon, authenticated;
grant select, insert, update on public.hmp_review_requests to service_role;

alter table public.hmp_admin_reviews add column source_request_id uuid unique references public.hmp_review_requests(id);
alter table public.hmp_admin_reviews alter column published set default false;

-- Invoker-only, service-role-only transaction: consume a private invitation once,
-- create an unpublished review, and record consent together. Retries are harmless.
create function public.hmp_submit_requested_review(p_token_hash text, p_review jsonb, p_consent text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare invitation public.hmp_review_requests; review_id uuid;
begin
  select * into invitation from public.hmp_review_requests where token_hash=p_token_hash for update;
  if not found or invitation.expires_at <= now() then
    raise exception 'This review link is no longer available.';
  end if;
  if invitation.submitted_at is not null then
    select id into review_id from public.hmp_admin_reviews where source_request_id=invitation.id;
    return review_id;
  end if;
  if coalesce(length(trim(p_review->>'reviewer_name')),0) not between 1 and 120
     or coalesce(length(trim(p_review->>'review_text')),0) not between 1 and 1200
     or coalesce((p_review->>'rating')::int,0) not between 1 and 5
     or coalesce(length(p_consent),0)=0 then
    raise exception 'Invalid review.';
  end if;
  insert into public.hmp_admin_reviews
    (reviewer_name, reviewer_role, review_text, service, rating, published, is_placeholder, display_order, created_by, source_request_id)
  values (p_review->>'reviewer_name', p_review->>'reviewer_role', p_review->>'review_text', p_review->>'service',
    (p_review->>'rating')::smallint, false, false, 0, 'Client review request', invitation.id)
  returning id into review_id;
  update public.hmp_review_requests set submitted_at=now(), consent_text=p_consent where id=invitation.id;
  return review_id;
end;
$$;
revoke execute on function public.hmp_submit_requested_review(text,jsonb,text) from public, anon, authenticated;
grant execute on function public.hmp_submit_requested_review(text,jsonb,text) to service_role;
