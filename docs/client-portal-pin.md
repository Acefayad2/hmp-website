# Client portal PINs

Messaging and seating guest-list links each require their own client-created six-digit PIN. This is an additional gate on the existing private link, not a shared client account. New and existing links enroll at first use. Never ask clients to send their PIN to staff.

## Admin reset

- Messaging: Admin → Messages → conversation → **Reset client PIN**. Confirmation rotates the private link and emails the new link. If delivery fails, copy and securely share the new link manually.
- Seating: Event overview → Event tools → **Reset client PIN**. Copy and securely share the newly generated client upload link.

Resets invalidate the old private link and sessions without deleting messages, documents, guests, or uploads. The client chooses a new PIN after opening the new link. There is no client reset endpoint. Existing link-renewal actions also invalidate that link's PIN.

## Infrastructure

Apply `supabase/migrations/20260928060218_client_portal_pins.sql` before either site deploy. Both sites use the same database. The table and atomic rate-limit function are service-role-only with RLS enabled and no browser policies. The helper in `netlify/functions/_client-pin.mts` is identical in this repository and `Acefayad2/HMP`.

PINs use salted scrypt hashes. Sessions are HMAC-signed, scoped to the private link and credential version, and expire after eight hours. Cookies are HttpOnly, SameSite=Strict, Secure on HTTPS, and host-only. Every portal read, upload preparation and mutation checks the private link and PIN session. Mutations require the same origin. Ten sign-in/setup attempts per private link per fifteen minutes are reserved atomically in Postgres. Database errors fail closed.

## Verification

Run `node --test tests/*.test.mjs`, `npm run build`, and `npm run build:functions`. The seating repository also runs `npm run check`.

Tests cover enrollment, confirmation mismatch, concurrent enrollment, wrong PIN, rate limiting, expiry, forged/cross-link sessions, origin checks, database failures, admin-only reset and preserved client records. Browser checks use isolated mocked clients; never reset a real client's link or send a test email to a client. The database rate-limit check uses synthetic rows inside a rolled-back transaction.
