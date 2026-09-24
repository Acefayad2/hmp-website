# Admin message email notifications

Admin replies, proposals, and attachment-only messages notify the client at the email address stored on their inquiry. The notification links to their private conversation and uses the existing configured email sender.

## Behavior

- Saved messages retain the email provider acceptance timestamp or a visible notification failure. Historical messages with no recorded status are not marked as delivered or emailed retroactively.
- A failed email does not discard the message or attachments. Admins can retry the email from the saved message without creating another chat message.
- Notifications use a stable, message-specific provider idempotency key. Successfully recorded notifications are not resent. Provider idempotency retention still applies if an email succeeds but its database status cannot be saved; that condition produces a warning.
- Inactive conversation links, invalid recipient addresses, missing email configuration, and provider/network failures produce explicit failures instead of an unconditional success message.
- Retry actions require the existing admin authorization and same-origin checks. Recipient addresses and conversation ownership are resolved server-side.
- “Email notification sent” means the email provider accepted the request, not proof that it reached the recipient’s inbox.

## Release prerequisites

Apply `supabase/migrations/20260924004440_message_email_notifications.sql` before deploying this code. Confirm `RESEND_API_KEY` and `HMP_INQUIRY_FROM_EMAIL` (or `HMP_INVOICE_FROM_EMAIL`) are configured for the production site. Other pending branch migrations/features must be considered before publishing the branch.

No production migration, deployment, or real-client email was performed during this change.

## Verification

- All 45 Node tests passed, including five notification tests covering successful sends, failures, idempotent retries, authorization, proposals, and attachment-only messages.
- Frontend and function builds passed.
- Migration verified in an isolated PostgreSQL-compatible database; existing message content remained intact and historical notification fields remained null.
- Desktop and mobile browser checks with mocked APIs verified persistent failure warnings, an email-only retry, and the success state with no duplicate chat message.
