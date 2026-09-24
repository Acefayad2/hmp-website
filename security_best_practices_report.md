# HMP security review — September 24, 2026

## Summary

Targeted review of the vanilla-JS website/Netlify functions and React seating app, plus read-only checks of the verified HMP Supabase project. Two confirmed code/dependency risks were corrected locally; production database/security maintenance remains open. This is not a penetration test or a claim of complete security. No secrets or client rows were collected into this report.

## SEC-01 — Medium — private host data persisted into kiosk storage (fixed locally)

- Location: seating repository `components/seating/host-mode.tsx:44`, `lib/seating-offline.ts:71`.
- Evidence: host loading passed the complete `result.guests` to the shared offline cache; the cache serialized `guests` unchanged. That included internal notes, client notes, email, phone and accessibility information.
- Impact: someone with access to the shared browser profile/devtools could recover staff-only information after host use; public API projection alone did not prevent this local persistence.
- Fix: assignment-only projection before persistence and on read, plus legacy-cache rewriting at `lib/seating-offline.ts:95`. Regression and browser fixtures confirm private fields are removed and VIP status remains.
- Limit: old device caches are not remotely erased. Reopen the updated app/event after deployment or clear its site data when retiring a kiosk. Offline guest names/assignments remain intentionally available for offline check-in.

## SEC-02 — High upstream advisory — vulnerable XML parser (fixed locally)

- Location: seating `package-lock.json:4256`; dependency path `mammoth -> @xmldom/xmldom`.
- Evidence: installed 0.8.13 was flagged by npm audit; updated to compatible patched 0.8.15. Crafted XML can exhaust parser memory; exploitability in every HMP import path was not demonstrated.
- Source: [upstream advisory and patch](https://github.com/advisories/GHSA-965w-775f-mr7g).
- Also patched compatible `postcss-selector-parser` 6.1.2 → 6.1.4 and build-tool `js-yaml` → 4.3.2. No force/major dependency upgrade. Full npm audits of both repositories return zero known advisories at audit time, not a guarantee of no vulnerabilities.

## SEC-03 — Medium operational risk — live Postgres security updates pending (open)

- Evidence: Supabase security advisor for verified project `zzhkxvtadaewsbgruqxa` reports `vulnerable_postgres_version`, installed `supabase-postgres-17.4.1.069`.
- Impact: outstanding vendor security patches remain unapplied. Exact CVEs/reachability were not established in this review.
- Action: [review the supported upgrade procedure](https://supabase.com/docs/guides/platform/upgrading), confirm backup/restore and maintenance window, then upgrade with approval. No database upgrade performed.

## SEC-04 — Low / hardening — authentication options (open)

Supabase advisors report leaked-password protection disabled and insufficient MFA options. This applies to Supabase Auth; the website also uses Netlify Identity and seating has host PIN/custom session flows, so this does not establish that all those flows have the same settings. Review the actual administrator login paths and enable supported protections deliberately: [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [MFA](https://supabase.com/docs/guides/auth/auth-mfa).

## SEC-05 — Low / defense-in-depth — public/admin main-site CSP incomplete (open)

Main `netlify.toml` has nosniff/frame/referrer protections; strict CSP is scoped to conversation, agreement and review pages, not the general public/admin shell. Production homepage headers confirmed no CSP there. No exploitable DOM XSS was established; reviewed admin template interpolations escape text. Expand CSP through a report-only compatibility phase rather than adding wildcard/unsafe-eval permissions or breaking authentication.

## Verified safeguards and advisor triage

- Unauthenticated production messages/events reads return 401. Tests cover unauthorized admins/hosts, cross-origin mutations, wrong/expired client tokens, VIP self-check-in denial, private-note export exclusion, review approval and signing consent. Real destructive/email operations were not exercised.
- Client preview fix at main `netlify.toml:30` allows blob images/frames only. `script-src 'self'`, no framing by others, no object embeds and no-referrer remain. Two local image previews/removal passed with that exact policy injected as a browser response header.
- Supabase RLS-with-no-policy INFO findings on server-managed tables are default-deny for ordinary client roles, not an instruction to grant public access.
- GraphQL schema warnings for `events`, `guests`, `transactions` do not by themselves prove row disclosure. Read-only policy inspection showed `is_hmp_portal_user()` restrictions; the SECURITY DEFINER helper uses an empty search path and returns a boolean authorization check. Preserve this deliberate gate unless redesigning the legacy portal.
- Public `hmp_seating_activity` SELECT is intentional for realtime invalidation; schema contains only `event_id` and `updated_at`, not guest notes/contact rows. This still exposes event activity metadata; assess privacy needs before altering realtime. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed).
- Production build artifacts were regenerated without the local QA identity fixture. No secret values were printed or committed; exhaustive historic secret scanning was not performed.

See `docs/audit-2026-09-24.md` for missing migrations, release gates and limitations. Security-driven changes were kept narrow: safe cache projection, compatible dependency patches and constrained preview permissions.
