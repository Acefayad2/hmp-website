# Dedicated Forms workspace

Replaces the unused Events sidebar destination with Forms (`/admin?view=forms`). Old `view=events` links also open Forms. The four existing online agreement templates and client form records now live here, independently of Invoices & Contracts. The Contracts tab retains the custom contract editor and records.

The Forms workspace loads and refreshes agreement records through the existing authenticated API. Template contents, signature handling, and permissions are unchanged.

Verification: 35 Node tests passed; frontend build passed. Local browser checks with mocked authentication/data verified all four template editors, navigation between Forms and Contracts, the legacy Events link, and desktop/mobile layouts (1440px/390px). No real client records or emails were created.

Release: pushed to the pending website change branch only, not production. The online forms feature still requires its existing database migration and deployment as documented in client-agreement-forms-2026-09-23.md.
