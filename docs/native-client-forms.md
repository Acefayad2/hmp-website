# Native client information forms

Admin → Forms contains native versions of the three supplied Google information forms. Their source URLs are retained in `information-form-schema.mjs` for provenance; existing Google responses are not imported or changed.

## Workflow

1. Choose **Prepare client form** and enter the client name, email, and optional event reference.
2. Save a draft, create a private link (no email), or email the form using the existing verified sender.
3. The client fills in the HMP page and selects **Submit information**. Only a successful server response confirms saving; failed submissions retain the entries for retry.
4. Open the client record under **Client forms & responses** to review answers or print/save a PDF. Search matches the client, email, template, and status.

Information forms do not require electronic signatures. The existing signed service agreements remain in **Invoices & Contracts → Contracts**, and payment receipts remain in Forms.

## Storage and access

- Uses the existing `hmp_client_agreements` table, with versioned `kind: information` snapshots and validated `client_answers`. No schema migration or new secret is required.
- Admin operations require an authenticated allowlisted HMP administrator. Direct anonymous/authenticated database access remains revoked, with RLS enabled.
- Private links use the existing random/HMAC token mechanism; only a token hash is used for lookup. The token stays in the URL fragment and is sent as a bearer header, not a query parameter.
- Draft, Sent, Completed, and Void lifecycle; activation expires after 90 days. Voiding disables the link. Completed responses are read-only under the existing database trigger; create a new form for corrections.
- Responses are saved on submission, not automatically while typing. The page warns before leaving unsaved entries.
- Email retries reuse the existing idempotency key. Link-only creation never emails anyone.
- Payment questions request public payment handles only. QR screenshots still use HMP Messages/email, as described on the form; never collect account credentials here.

## Verification

Run `node --test tests/*.test.mjs`, `npm run build`, and `npm run build:functions`.

Coverage includes all three create/share/submit/reopen lifecycles, required-field validation, escaped output, protected admin routes, expired/void links, immutable completion, idempotent submission/email retries, database failure, navigation, and preservation of contract consent requirements.

Browser verification uses isolated local test data and mocked authentication with the real form handler, not real client emails. A rollback-only production database check verifies the existing storage permissions and lifecycle without leaving a test record.
