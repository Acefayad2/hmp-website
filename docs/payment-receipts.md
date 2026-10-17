# Payment receipt template

Admin → Forms → Payment receipts → Create payment receipt.

- Select an invoice saved as **Sent** or **Paid** in Invoices & Contracts. Draft, voided, and deleted invoices cannot be receipted.
- Enter the actual payment date and method, an optional non-sensitive reference, and an optional client-facing note.
- Enter **Amount paid to date**: the total actually received for this invoice, including earlier installments. This is not just the latest payment. The field starts blank, even for an invoice marked Paid.
- Confirm that the entered amount was received. Preview, then choose **Print / Save PDF** and save the PDF for your records.
- Attach the PDF to the client's Messages conversation or send it through your email.

The template uses the saved invoice number, client and event details, service descriptions, discount, tax, and total. Receipt numbers use `R-` followed by the invoice number. The remaining balance is the invoice total minus the entered amount paid to date, calculated in cents. Amounts must be positive, use at most two decimal places, and not exceed the invoice total.

The receipt badge says **Partial payment received** while a balance remains, and **Paid in full** only when the entered amount equals the invoice total. The footer uses matching wording. This status is calculated from the entered amount, not inferred from the invoice's saved status.

This is a manually prepared cumulative-payment receipt, not payment processing or an installment ledger. Dates/methods are never inferred from the invoice issue date or modification timestamp. The protected invoice endpoint is checked again before preview and print; changed records must be reopened. No invoice, payment status, client conversation, or email is written automatically. If a partially paid invoice was previously marked Paid, HMP must separately correct that saved status.

Payment details entered in this template are held only in the current browser dialog. They are not saved to the server. Keep the PDF as the issued record. Client-facing receipts deliberately exclude invoice notes/payment instructions and internal data.

Verification covers partial/full amounts, remaining cents, invalid and excessive amounts, ineligible invoices, escaping, and unchanged source records. Browser checks use synthetic invoices; no live financial records are changed and no client emails are sent.
