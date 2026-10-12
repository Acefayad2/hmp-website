-- Retain sent proposals for Admin while allowing a mistaken send to be withdrawn
-- from the client portal. Existing messages remain visible by default.
alter table public.hmp_client_messages
  add column if not exists proposal_withdrawn_at timestamptz;

alter table public.hmp_client_messages
  add constraint hmp_client_messages_proposal_withdrawn_check
  check (
    proposal_withdrawn_at is null
    or (sender = 'admin' and left(body, 16) = 'HMP_PROPOSAL_V1:')
  );
