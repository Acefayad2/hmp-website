# Proposals sidebar workspace

- Keep one Invoices & Contracts sidebar item with its existing two internal tabs.
- Add a separate Proposals sidebar item at `/admin?view=proposals`.
- Pick an existing client conversation to create a proposal, or use the existing
  New client & proposal flow. No new client records are created by navigation.
- List sent admin proposals newest first, with client, title, fee, sent date,
  expandable details, Print / Save PDF, and Open client conversation.
- Reuse the authenticated messages API and proposal editor. Proposals remain in
  both admin and client conversations; no schema or email behavior changes.
- Preserve expanded records and client selection on background refresh. Display
  loading failures and proposal email-notification results in the new workspace.

Verification: 60 Node tests passed; production build passed. Local browser checks
used synthetic clients and mocked APIs only. Checked both document tabs retain
the shared sidebar selection, Proposals routing, correct editor recipient,
new-client dialog, sent-proposal expansion, conversation navigation, and mobile
layout without horizontal overflow. No real client messages or emails were sent.

Release: pushed to the change branch, not published to production. Publication
still requires approval under the website preview-first policy.
