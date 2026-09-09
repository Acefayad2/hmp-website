create table if not exists public.hmp_conversation_attachment_uploads (
  id uuid primary key,
  conversation_id uuid not null references public.hmp_client_conversations(id) on delete cascade,
  message_id uuid not null,
  path text not null unique,
  file_name text not null,
  content_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 26214400),
  uploader text not null check (uploader in ('client', 'admin')),
  attached_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists hmp_conversation_attachment_uploads_rate_idx
  on public.hmp_conversation_attachment_uploads (conversation_id, uploader, created_at desc);

alter table public.hmp_conversation_attachment_uploads enable row level security;
alter table public.hmp_conversation_attachment_uploads force row level security;
revoke all on table public.hmp_conversation_attachment_uploads from anon, authenticated;
grant all on table public.hmp_conversation_attachment_uploads to service_role;

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/ogg', 'video/x-msvideo', 'video/mpeg',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv'
]::text[], updated_at = now()
where id = 'hmp-conversation-attachments';
