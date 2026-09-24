# Combined Invoices & Contracts section

The Admin sidebar now has one **Invoices & Contracts** entry. Inside, the **Invoices** and **Contracts & Forms** tabs show the existing billing workspace and agreement tools respectively. Client forms, signatures, custom contracts and invoice editors remain unchanged.

Existing `/admin?view=invoices` and `/admin?view=contracts` links still select the correct tab. Both routes highlight the combined sidebar entry and use the same page heading. The sidebar opens Invoices by default. Tabs support keyboard arrows, Home/End, selected states and labeled panels. Browser history and active-workspace live updates continue to use the existing routes.

Validation: 34 Node tests and frontend build pass. Added tests execute the actual workspace-navigation function to check visibility, labels, selection, loaders and routes. Browser checks with local synthetic API responses covered both tabs, invoice and contract editor opening, keyboard navigation, Back/Forward, Messages navigation, contracts deep link, and 390px mobile layout. Desktop and mobile screenshots were visually reviewed.

No records or database schemas changed. Prepared on `codex/seamless-page-scroll` in `Acefayad2/hmp-website`; not live until publishing is approved. Earlier release migrations still apply to the pending branch.
