# Payment receipt template

Admin → Forms → Payment receipts → Create payment receipt.

- Select an invoice saved as **Sent**, **Partially paid**, or **Paid in full** in Invoices & Contracts. Draft invoices can be linked to receipt drafts, but cannot produce an issued receipt until sent. Voided and deleted invoices cannot be receipted.
- Enter the actual payment date and method, an optional non-sensitive reference, and an optional client-facing note.
- Enter **Amount paid to date**: the total actually received for this invoice, including earlier installments. This is not just the latest payment. The field starts blank, even for an invoice marked Paid.
- Confirm that the entered amount was received. Preview, then choose **Print / Save PDF** and save the PDF for your records.
- Attach the PDF to the client's Messages conversation or send it through your email.

The template uses the saved invoice number, client and event details, service descriptions, discount, tax, and total. Receipt numbers use `R-` followed by the invoice number. The remaining balance is the invoice total minus the entered amount paid to date, calculated in cents. Amounts must be positive, use at most two decimal places, and not exceed the invoice total.

The receipt badge says **Partial payment received** while a balance remains, and **Paid in full** only when the entered amount equals the invoice total. The footer uses matching wording. This status is calculated from the entered amount, not inferred from the invoice's saved status.

This is a manually prepared cumulative-payment receipt, not payment processing or an installment ledger. Dates/methods are never inferred from the invoice issue date or modification timestamp. The protected invoice endpoint is checked again before preview and print; changed records must be reopened. No invoice, payment status, client conversation, or email is written automatically. If a partially paid invoice was previously marked Paid, HMP must separately correct that saved status.

## Private drafts

Choose **Save draft** to save incomplete details privately in **Drafts → Payment receipts**. An invoice can be selected later. Reopen the draft from that category to continue; subsequent saves update the same draft. A stale session cannot overwrite a newer revision. Saving does not require payment confirmation, and that checkbox is deliberately reset when reopening. Preview and print still require complete, valid payment details and fresh confirmation. Unsaved changes trigger a close warning.

Drafts are stored in `hmp_admin_receipt_drafts`, available only through the authenticated Admin endpoint. RLS is enabled, public/anon/authenticated grants are revoked, and the server role has only select/insert/update access. A removed invoice does not remove a draft. Drafts are not issued records or messages: printing does not mark them sent or remove them. Keep each issued PDF for your records. Client-facing receipts exclude invoice notes/payment instructions and internal data.

For the retainer-to-final-payment workflow in IMG_1916: save the retainer receipt as a draft before printing its PDF. When the remaining payment arrives, reopen that same draft, update **Amount paid to date** to the cumulative full amount, update the payment date/method/note as needed, and confirm receipt of payment again. Save and print a new PDF. Previously downloaded or sent PDFs remain unchanged; share the new PDF with the client separately.

## Invoice status

HMP manually selects **Partially paid** after a retainer/installment, or **Paid in full** when fully paid. The existing stored `Paid` value is retained for compatibility. Saving a receipt never changes that status. Resending an invoice preserves its payment status. Newly emailed/shared invoice copies include the recorded partial/full status; previously sent copies remain unchanged and are labeled as snapshots, not live payment records.

Deploy the two `20261017` receipt-draft/status migrations before releasing the frontend/functions. No existing invoices or sent snapshots are rewritten by the migrations. Local SQL verification: `node scripts/check-receipt-draft-migrations.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js` (synthetic in-memory database only).

Verification covers partial/full amounts, remaining cents, invalid and excessive amounts, ineligible invoices, escaping, and unchanged source records. Browser checks use synthetic invoices; no live financial records are changed and no client emails are sent.
