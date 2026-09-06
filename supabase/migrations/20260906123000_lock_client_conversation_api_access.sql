create policy "No direct API access to client conversations"
  on public.hmp_client_conversations
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "No direct API access to client messages"
  on public.hmp_client_messages
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
