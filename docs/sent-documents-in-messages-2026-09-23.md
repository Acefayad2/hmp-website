# Sent invoices and contracts in Messages

Newly sent invoices and contracts now appear in the private conversation shared by the admin and client. Each card expands to show the client-facing document details, line items/totals or contract terms. It is a snapshot of the document as sent, not a live payment or signature status view.

## Sending and privacy

- Existing linked inquiries must belong to the same email recipient as the document. A mismatched inquiry or recipient blocks sending; private documents are not shared based on a client's name.
- Unlinked documents reuse an inquiry only when email and event date match uniquely. Otherwise a manual inquiry is created and linked, avoiding ambiguous matches. A private conversation is created if needed. Revoked or expired links are not silently reactivated: the admin must use Send new link first.
- The document email includes a private conversation link. No extra chat notification email is sent for the same document.
- Only successful email-provider responses proceed to recording the sent copy. A service-role-only database function writes the message, document sent status, and conversation activity together. If saving fails, the admin sees that email succeeded but the conversation copy needs a retry.
- Unchanged retries within the open editor reuse the provider idempotency key. The database message identifier is deterministic per send request, preventing duplicate chat entries. A deliberate new send after success creates a new copy. Provider idempotency retention still applies; refreshing the admin page resets its in-memory retry key.
- Both message APIs return only documents from the authorized conversation. Snapshot fields are allowlisted; billing addresses, provider identifiers, ownership metadata, and arbitrary record fields are excluded.
- Existing sent documents are not backfilled: their original sent content cannot be reconstructed safely from an editable current record.

## Release

Apply `supabase/migrations/20260924005355_sent_document_messages.sql` after the earlier message-email migration, before deploying. The existing invoice and contract email configuration is reused. Other pending branch migrations/features must also be considered before production publication.

This change was committed on the pending website branch, not deployed to production. No real client emails or production database changes were made.

## Verification

- 51 Node tests passed, including new invoice/contract send, private retrieval, retry, failure, recipient mismatch, inactive-link, standalone-document, and snapshot-field tests.
- Frontend and function builds passed.
- `scripts/check-document-message-migration.mjs` verified atomic rollback, status updates, deduplication, snapshot preservation, recipient checks, and denied anonymous/authenticated database access using an isolated PGlite database.
- Mocked browser checks verified expandable cards in both admin and client conversations at 1440px and 390px widths, with no horizontal overflow from the new cards. Desktop and mobile screenshots were visually inspected.
