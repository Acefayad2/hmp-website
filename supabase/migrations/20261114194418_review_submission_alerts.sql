-- Keep client review submissions immutable while alerting Admin through the
-- existing private notification outbox. Historical notifications are retained.
alter table public.hmp_admin_notifications
  alter column agreement_id drop not null,
  add column if not exists review_id uuid unique references public.hmp_admin_reviews(id) on delete set null;

alter table public.hmp_admin_notifications
  drop constraint if exists hmp_admin_notifications_kind_check,
  add constraint hmp_admin_notifications_kind_check
    check (kind in ('form_completed', 'agreement_signed', 'review_submitted'));

create or replace function public.hmp_queue_review_notification() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.hmp_admin_notifications
    (review_id, client_name, title, kind, created_at)
  values
    (new.id, new.reviewer_name, 'Website review', 'review_submitted', new.created_at)
  on conflict (review_id) do nothing;
  return new;
end;
$$;
revoke all on function public.hmp_queue_review_notification() from public, anon, authenticated;
grant execute on function public.hmp_queue_review_notification() to service_role;

drop trigger if exists hmp_queue_review_notification on public.hmp_admin_reviews;
create trigger hmp_queue_review_notification
after insert on public.hmp_admin_reviews
for each row when (new.source_request_id is not null)
execute function public.hmp_queue_review_notification();

create or replace function public.hmp_guard_submitted_review() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.source_request_id is not null and (
    new.reviewer_name is distinct from old.reviewer_name or
    new.reviewer_role is distinct from old.reviewer_role or
    new.review_text is distinct from old.review_text or
    new.service is distinct from old.service or
    new.rating is distinct from old.rating or
    new.display_order is distinct from old.display_order or
    new.created_by is distinct from old.created_by or
    new.source_request_id is distinct from old.source_request_id
  ) then
    raise exception 'Client-submitted reviews cannot be edited';
  end if;
  return new;
end;
$$;
revoke all on function public.hmp_guard_submitted_review() from public, anon, authenticated;
grant execute on function public.hmp_guard_submitted_review() to service_role;

drop trigger if exists hmp_guard_submitted_review on public.hmp_admin_reviews;
create trigger hmp_guard_submitted_review
before update on public.hmp_admin_reviews
for each row execute function public.hmp_guard_submitted_review();
