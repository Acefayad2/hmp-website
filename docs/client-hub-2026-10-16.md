# Per-event client hub and activity

Source: IMG_1867.mov supplied October 16, 2026.

## Behavior

- Each existing inquiry conversation becomes an event-specific hub. No email-wide
  aggregation, new client accounts, PIN resets, or existing document rewrites.
- Messages, proposals, invoices, contracts, and forms have separate filters.
  Proposals open in a closeable native dialog, with the existing print/PDF action.
- Admin explicitly chooses a sent form for that event. The server requires a
  matching client email and active form/hub; the confirmation identifies the event.
  Existing plain-text links are not silently reassigned.
- Admin pastes the private Guest Seating client link under Guest Seating. The
  server verifies its event, token, active state and event date before sharing.
  The client Guest Seating tab appears only after a link is added.
- Client Activity lists clients/events, shared documents, signed contracts,
  completed shared forms, client messages and recorded Guest Seating actions.
  Guest Seating activity comes only from that event's verified link.
- Existing drafts and sent records remain unchanged. Existing authentication,
  client PINs and Admin allowlisting remain required.
- Saving an inquiry as Booked automatically prepares its Admin hub if missing.
  Existing hubs, links, PINs, and revoked/expired access are preserved. Concurrent
  saves use the unique inquiry ID and cannot overwrite another save's credentials.
  No email is sent by booking. If hub creation fails, the saved booking remains
  visible with a specific retry warning; saving again safely retries hub creation.
  Existing Booked inquiries can also be saved again to prepare a missing hub.

## Database release dependency

Apply 20261016185020_client_hub_document_kinds.sql before publishing the functions.
The existing check allows only invoice/contract document kinds. This migration
adds form/seating, preserving the sender=admin restriction and existing rows.
It changes no RLS, roles, grants, secrets, storage, or account permissions.
Production application requires the user's explicit approval.

## Verification

- npm run check: 187 tests passed; static and 17 function builds passed.
- Mocked browser checks: Admin/client proposal dialogs, close/focus behavior,
  document filters, completed/signed timeline, Guest Seating link, desktop/mobile
  layouts with no horizontal overflow.
- Read-only live schema checks confirmed existing JSONB storage and Guest
  Seating activity fields. No production test events, messages or uploads.
- Preview is prepared; production release is pending database approval.
- Follow-up shortened IMG_1867 recording: booking-to-hub behavior additionally
  verified in a mocked browser, including Open Client Hub and Client Activity on
  desktop and mobile. No live clients or records were used.

## Existing project advisories (read-only review)

No grants, policies, authentication settings or database version were changed.
Supabase's advisory report also lists pre-existing items outside this feature:

- [Public GraphQL schema visibility](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed)
  for hmp_seating_activity, and
  [authenticated schema visibility](https://supabase.com/docs/guides/database/database-linter?lint=0027_pg_graphql_authenticated_table_exposed)
  for events, guests and transactions. Schema visibility alone is not evidence
  that protected rows can be read.
- [Security-definer function access](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
  for is_hmp_portal_user requires a separate review of its intended callers.
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
  [MFA options](https://supabase.com/docs/guides/auth/auth-mfa), and
  [Postgres security patches](https://supabase.com/docs/guides/platform/upgrading)
  remain project-level follow-up items.
- RLS-without-policies notices for server-only tables are not a reason to grant
  browser access. This feature continues to use authorized server handlers.
