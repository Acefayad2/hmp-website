alter table public.hmp_client_messages
  add column email_notified_at timestamptz,
  add column email_notification_error text;
comment on column public.hmp_client_messages.email_notified_at is 'Email provider accepted the admin-reply notification; not an inbox-delivery receipt.';
comment on column public.hmp_client_messages.email_notification_error is 'Admin-only notification failure/status. Null on historical messages does not assert delivery.';
