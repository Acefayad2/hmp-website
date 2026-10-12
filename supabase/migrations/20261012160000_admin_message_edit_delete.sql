-- Retain removed messages for recovery while hiding them from both portals.
alter table public.hmp_client_messages
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;
