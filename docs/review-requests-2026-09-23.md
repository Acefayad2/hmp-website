# Emailed review requests and admin approval

## Workflow

- Admin > Reviews > Request review by email. Enter a client name and email; this does not require an inquiry.
- A private, single-use submission link expires after 30 days. The client chooses a display name, rating (all 1–5 ratings accepted), one or more services, and review text, then consents to public display after approval. Email addresses stay private.
- Submissions appear in Reviews as Awaiting approval, with `published=false`. Open a review and select Approve & publish to show it on the landing page. Save privately without approving, uncheck Approved for website to unpublish, or delete to decline.
- Request history shows email state and receipt. Unconfirmed emails can be retried. Request IDs and provider idempotency keys stay stable on retries. Resend idempotency has a provider-defined retention window; if delivery status cannot be recorded, verify delivery before a later retry.

## Implementation and privacy

- Existing allowlisted Netlify admin identity is required to request emails or publish reviews. Same-origin write checks apply to both routes.
- Client links use domain-separated HMAC tokens in URL fragments, not query strings, and bearer headers for API calls. Only the token hash is stored. Client form/API responses omit client emails and token metadata.
- SQL transaction locks the invitation, inserts exactly one unpublished review, and records consent. Retrying after submission or after an admin deletes the review cannot recreate it.
- The requests table has RLS enabled and no public/anonymous/authenticated grants. The RPC uses security invoker and is executable only by service_role. Existing review-table RLS and service-role-only grants were checked read-only.
- Existing published reviews are unchanged. New review rows default to unpublished; the admin API requires an explicit boolean true to publish.

## Verification

- 40 Node tests passed, including unauthorized access, wrong/expired tokens, spoofed publication, approval/unpublish visibility, validation, email retry/idempotency, and escaped email names.
- Frontend and Netlify function builds passed.
- Real SQL migration tested in isolated PGlite using scripts/check-review-request-migration.mjs: rollback, duplicate prevention, expiry, declined-review non-resurrection, and role permissions.
- Local browser checks with mocked data/email endpoints: desktop and 390px mobile, email-request dialog, pending review approval, multiple services, submission failure preserves draft, retry succeeds, completed state on reload, missing token error. Screenshots inspected under output/playwright. No real clients were emailed or records modified.

## Release pending approval

Apply `supabase/migrations/20260924003341_client_review_requests.sql` to the verified HMP database before deploying the website and functions together. Uses existing `RESEND_API_KEY` and `HMP_CONTRACT_FROM_EMAIL` (fallback `HMP_INVOICE_FROM_EMAIL`), plus existing Supabase/admin configuration. No secrets or account settings were changed. This commit is not a production deployment.
