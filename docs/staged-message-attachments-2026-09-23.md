# Stage attachments before sending

Both admin and client message composers keep selected files locally until the user explicitly clicks Send. The existing preview and × removal controls are retained, with clearer text explaining that files are not uploaded yet.

The file picker now adds to a separate in-memory draft queue instead of replacing an earlier selection. Users can select several images together or reopen the picker to add more. Identical file selections are deduplicated. Removing files no longer depends on assigning a synthetic `DataTransfer` to the native file input.

Existing limits remain unchanged: four files per message, 25 MB per file, 50 MB total, and the same supported types. Invalid selections stay visible and removable; validation prevents sending until corrected. Removing before Send removes only a local selection, not a server file.

Successful sends clear the queue and preview object URLs; failed sends retain the selection. Admin conversation switches preserve the existing discard-confirmation behavior with the new queue. A browser-supported unload warning protects unsent attachments, but drafts are not persisted across an accepted refresh or tab closure.

Verification: all 53 Node tests and the frontend build passed. Mocked browser tests exercised both composers, multiple selection, additive selection, removal, zero upload calls before Send, two images in one message, clearing after success, retention after a failed client send, and admin discard/cancel behavior. Client mobile and admin desktop previews were visually inspected. No files were uploaded to production and no real messages were sent.

Pending branch only; not deployed. This frontend change adds no database migration, but the branch's previously pending backend features still require their migrations before publication.
