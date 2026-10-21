# HMP website completion notifications

`HMP_COMMUNICATION_EMAIL` (Netlify production Functions scope) overrides the website's legacy sender, reply-to, and Admin alert recipient settings. It does not change login allowlists, mail DNS, or the separate seating app. Existing client replies still use the client's address as Reply-To in the internal alert.

New native information-form completions and signed agreements create one private `hmp_admin_notifications` row atomically with completion. Historical records are not backfilled or emailed. Signed documents, signatures, payment records, and form responses are unchanged. Only server-side service-role access is granted; Admin API access additionally requires an authenticated allowlisted Admin.

Admin → Notifications shows the latest 100 alerts, document links, per-Admin read status, and email acceptance status. A minute-scheduled Netlify function sends minimal notifications to HMP only. No answers, signatures, or client access tokens are emailed. Provider acceptance is not proof of inbox delivery.

Email processing leases five records at a time, retries at five-minute intervals up to five attempts, and stops before the provider's 24-hour idempotency window. A stable idempotency key and frozen sender/recipient prevent repeated delivery on ordinary retries. Failures remain visible in Admin. Do not manually resend a record beyond the idempotency window without checking provider delivery history.

Validation: automated API, email, rendering, and security regression tests; database migration and synthetic assertions executed atomically with all test records rolled back; desktop/mobile notification UI checks with synthetic data. `tests/completion-notifications.sql` must only be run against an isolated empty notification log inside a transaction that is rolled back. Never run that test standalone against a populated production queue.

Rollback: deploy the previous application version to stop the worker and hide the new panel. Leave the private table and trigger in place to preserve queued alerts; do not delete signed documents or notification history. The prior version ignores the new environment setting. This change does not add guest-list link revocation or seating-app completion notifications.
