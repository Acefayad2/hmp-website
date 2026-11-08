alter table public.hmp_admin_message_signature
  add column if not exists formatting jsonb not null default '[]'::jsonb
  check (jsonb_typeof(formatting) = 'array');
