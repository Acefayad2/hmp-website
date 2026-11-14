alter table public.hmp_admin_contracts
  add column if not exists additional_boxes jsonb not null default '[]'::jsonb
  check (jsonb_typeof(additional_boxes) = 'array' and octet_length(additional_boxes::text) <= 48000);
