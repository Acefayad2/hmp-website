# Payment receipt template

Admin → Forms → Payment receipts → Create payment receipt.

- Select an invoice previously saved as **Paid** in Invoices & Contracts.
- Enter the actual payment date and method, an optional non-sensitive reference, and an optional client-facing note.
- Confirm that full payment was received. Preview, then choose **Print / Save PDF** and save the PDF for your records.
- Attach the PDF to the client's Messages conversation or send it through your email.

The template uses the saved invoice number, client and event details, service descriptions, discount, tax, and total. Receipt numbers use `R-` followed by the invoice number. The amount paid equals that paid invoice's total; the balance is zero **for that invoice**, not necessarily for all services or other invoices.

This is a manually prepared full-payment receipt, not payment processing or an installment ledger. Dates/methods are never inferred from the invoice issue date or modification timestamp. Draft/Sent/Void invoices cannot be receipted. The protected invoice endpoint is checked again before preview and print; changed records must be reopened. No invoice, payment status, client conversation, or email is written automatically.

Payment details entered in this template are held only in the current browser dialog. They are not saved to the server. Keep the PDF as the issued record. Client-facing receipts deliberately exclude invoice notes/payment instructions and internal data.

Verification: receipt model/escaping tests; existing project tests; frontend and function builds; mocked authenticated browser flow, paid-only selection, full form, mobile overflow, PDF print layout, newly voided invoice, no paid invoices, and unauthorized response. No live financial records changed and no client emails sent.
