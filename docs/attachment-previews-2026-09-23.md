# Messaging attachment previews

## Fixes
- Wired the shared preview renderer into the admin composer; previously only a file-count summary was shown there.
- Both composers now show selected files with accessible X buttons, media previews, filenames, sizes, and an open-preview link. Images/video/audio that the browser cannot decode show an explicit fallback; Office documents open through the device's supported viewer, and PDFs also have an embedded preview.
- Invalid selections remain visible and removable rather than hiding the entire preview list. Existing file-count and size limits still prevent invalid sends.
- Supported file extensions supply MIME types when a mobile picker omits them; preparation and upload use the same type.
- Corrected the client send handler to select its submit button, not the first preview's remove button.
- File selection/removal is locked during sending, retained on failure, and cleared on success. Switching admin conversations asks before discarding unsent text/files.
- Updated asset versions and included shared preview CSS in the production build.

## Verification
- 16 Node tests passed; frontend build and diff checks passed.
- Local browser with mocked auth, upload and messaging endpoints: both actual composer flows displayed previews and removed individual files; outgoing payloads excluded removed files.
- Client failed-send test retained attachments and enabled removal/retry; successful sends cleared both composer queues.
- Real image, MP4 and PDF selected in admin; video dimensions remained unchanged during playback. Mobile viewport (390px) had no horizontal overflow.
- No real client messages/emails were sent and no production records/files were deleted.

## Release
Prepared on `codex/seamless-page-scroll`, pending publication approval with the other branch changes. The branch includes the invoice event-address migration described in `invoice-details-2026-09-23.md`; apply that migration before publishing the combined invoice functions.
