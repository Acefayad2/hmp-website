alter table public.hmp_client_messages
  add column if not exists text_formatting jsonb not null default '[]'::jsonb
  check (jsonb_typeof(text_formatting) = 'array' and octet_length(text_formatting::text) <= 40000);
