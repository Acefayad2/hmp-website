# Invoice description and event address

Requested changes: Enter/newlines in service descriptions; replace the billing
address input with an event address.

- Service descriptions are expanding textareas (existing 500-character limit).
- Event address is a separate field, limited to 1,000 characters. Historical
  `billing_address` values are neither relabeled nor overwritten.
- Email escapes content and preserves line breaks in both fields.
- Print replaces textarea controls with wrapping text and removes the modal's
  scroll clipping, so long descriptions can continue onto another page.

Verification: 10 Node tests, frontend and function builds; local browser test
using mocked authentication/API responses verified Enter, save payload, totals,
and 12-line descriptions at 390px and 1440px. Generated and inspected a two-page
Letter PDF. No client email or real invoice was created during testing.

Release pending approval:

1. Apply `20260923165336_invoice_event_address.sql` to the confirmed HMP database.
   This additive migration has not been run on production. Verify the column and
   existing RLS/grants; it must precede the function deployment.
2. Deploy the frontend AND updated invoice functions. Verify draft save/reopen
   with an authorized test invoice before treating production persistence as
   verified. Do not send a client email as a deployment test.
3. The branch also contains the prior, approved-for-preview-only scroll fix.
   Neither change has been published to production yet.
