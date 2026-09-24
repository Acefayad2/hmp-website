# Client agreement forms

## Scope

Admin → Contracts → Client forms contains four reusable templates from the supplied PDFs:

- Guest Seating Experience Services Agreement
- Celebration Accessories Rental Agreement
- Premium LED Welcome Sign Services Agreement
- LED Signage Customization & Approval Agreement

The owner explicitly chose online completion/signing and confirmed **four included LED revisions**. The source wording is retained, except the two conflicting six-revision references now say four. Original PDF SHA-256 fingerprints are stored with each imported template. These are implementation changes, not a legal review or a claim of legal enforceability.

## Workflow

1. Admin chooses a template, enters client name/email and service-specific details, and saves a draft.
2. Admin reviews the full terms, fills required service fields, enters the representative's typed signature, and explicitly authorizes it before sending.
3. An email delivers a private 90-day link. It opens the agreement and matching client inputs on desktop or mobile without requiring another account.
4. Client reviews the terms, enters event details and consent choices, and submits a typed signature with explicit electronic-record consent.
5. Admin's existing 10-second synchronization updates the form list. Completed records include answers, exact terms/field snapshot, both typed names, consent, server time, browser information and a record fingerprint. Both sides can print/save the combined record and full terms.

The corresponding answers supply PDF blanks; event-date placeholders refer to the client-entered event date. Agreement wording is not silently shortened. The accessories title is retained from the supplied legal form rather than applying the public-site copy replacement to legal terms.

Existing custom contracts remain available and unchanged. These new forms use their own secure table. Sent forms cannot be edited: void and prepare a new form if needed. Completed forms cannot be overwritten or deleted. Links expire 90 days after issue, including client copy access; Admin retains access to completed records.

## Safety

- Netlify Identity plus the existing HMP admin email allowlist protects admin routes.
- 256-bit private access tokens use a separate HMAC domain; only hashes are used for client lookup. Tokens stay in URL fragments and authorization headers, not query strings.
- Same-origin mutations; no-store responses; no-referrer/noindex private page.
- RLS enabled, no `anon`/`authenticated` table access, service-role access only through server functions.
- Snapshot/recipient/owner/status cannot be supplied by client submissions.
- Atomic status-guarded signing; completed record retries never overwrite signatures.
- Optimistic draft concurrency; locked sent terms; database trigger preserves completed records.
- Email errors are reported and leave a recoverable private link. Successful-delivery retries do not send another email; uncertain delivery retries use the same provider idempotency key.
- Drafts may be incomplete; sending and signing enforce each template's required fields server-side.

## Verification

- `node --test tests/*.test.mjs`: schema coverage, preserved terms, revision correction, validation, HTML escaping, auth/origin/token boundaries, four full submissions, immutable completion/retries, draft concurrency, void/expired links, ownership/terms spoof protection, email failure recovery and deduplication.
- `npm run build` and `npm run build:functions`.
- Migration executed successfully in temporary PGlite PostgreSQL; queries confirmed RLS, anonymous/authenticated access denial, and rejection of completed-record updates/deletes. No production database changes made.
- Browser QA with synthetic data and mocked endpoints (no real emails): all four client forms completed, failed submission retained inputs then retried, mobile 390px without horizontal overflow, read-only completed copy, print view, Admin four-template library, save draft/reopen/send/void, desktop and mobile.
- Screenshots in ignored `output/playwright/agreement-*.png`. `scripts/agreement-qa-fixture.mjs` creates local-only fixtures after build; the production build never includes them.

## Release gate — not live

Requires publication approval. Apply the additive migration `20260923234320_client_agreement_forms.sql` to the verified HMP database before deploying the new functions and frontend together. Also account for the pending invoice event-address migration on this branch. Existing environment variables are reused; no new secrets required.

After approval: verify existing sender configuration, run one authorized test-recipient send/sign/print flow against the deployed environment, verify the completed record in Admin, and verify an expired/void link is denied. Do not send test agreements to real clients without permission. Local mocks do not prove production authentication, email delivery, or deployed database connectivity.
