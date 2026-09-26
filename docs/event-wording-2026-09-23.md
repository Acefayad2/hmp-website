# Event wording update

## September 26 product-name exception

The user restored **Celebration Kit** as the package name. Its card, detail page,
inquiry choice, metadata and displayed service labels use that name. Both old
"Event Kit" and "Celebration Kit" inquiry links remain compatible. General copy
and the Event Accessories category still use "event"; stored records are unchanged.

## Original September 23 change

- Replaced authored “celebration”/“occasion” wording with “event” (including plurals) across public pages, service details, metadata, accessible labels, admin labels, and inquiry/message email templates.
- Renamed the displayed services to Event Accessories and Event Kit.
- Preserved existing page URLs, form field names, and database/API keys for compatibility. Old inquiry links select the newly named services correctly.
- Display legacy service labels using the current names in reviews, admin filters/editors, and client conversations. Client-written review text and historical records are not rewritten.
- Updated script version references to avoid stale cached wording.

## Verification

- All 12 Node tests passed; frontend and function builds passed; diff whitespace checks passed.
- Local browser scan of public page copy found no remaining old terms; no JavaScript runtime errors.
- Old and new inquiry links both preselect Event Accessories and Event Kit.

## Release status

Prepared on `codex/seamless-page-scroll`; not published to production.
This branch also includes the pending scrolling and invoice changes. Publishing the combined branch requires the additive invoice event-address migration documented in `invoice-details-2026-09-23.md` before deploying its invoice functions.
