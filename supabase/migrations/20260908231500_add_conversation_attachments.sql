alter table public.hmp_client_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.hmp_client_messages
  drop constraint if exists hmp_client_messages_body_check;

alter table public.hmp_client_messages
  add constraint hmp_client_messages_body_check
  check (char_length(body) <= 4000);

alter table public.hmp_client_messages
  drop constraint if exists hmp_client_messages_attachments_check;

alter table public.hmp_client_messages
  add constraint hmp_client_messages_attachments_check
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 4);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'hmp-conversation-attachments',
  'hmp-conversation-attachments',
  false,
  26214400,
  array[
    'image/*',
    'video/*',
    'audio/*',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();
