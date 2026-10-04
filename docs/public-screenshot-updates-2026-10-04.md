# Public screenshot updates — October 4, 2026

## Changes

- Replaced the Guest Arrival and Arrival + Directory package descriptions with
  the supplied screenshot wording. Starting prices remain $800 and $1,450,
  respectively; existing package inquiry links and starting-price conditions
  are unchanged.
- Removed the Admin login link from all ten public marketing-page footers.
  Removed the production build's automatic reinsertion of that link.
- Preserved the admin page, dashboard entry point, authentication, API functions,
  and existing back-to-top control.

## Verification

- Inspected the two supplied screenshot images directly before editing.
- `npm run check`: 114 tests passed; frontend and serverless-function builds passed.
- `npm audit`: zero reported vulnerabilities.
- JavaScript syntax checks for the changed build script and new tests passed;
  `git diff --check` passed. This repository has no separate lint or typecheck script.
- Checked all 15 built HTML pages: public footer links are absent and the admin
  page and bundle remain packaged.
- Independent review found no issues and verified the screenshot text, unchanged
  prices, public-link removal, and preserved admin/authentication source.
- Local browser smoke could not start because of cloud sandbox/browser access
  restrictions. Verify the published service cards, all public footer links,
  inquiry destinations, and existing admin sign-in page during rollout.

No database, account-access, payment, or client-data changes are included.
