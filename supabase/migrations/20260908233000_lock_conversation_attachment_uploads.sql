create policy "No direct API access to conversation attachment uploads"
  on public.hmp_conversation_attachment_uploads
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
