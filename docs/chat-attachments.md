# Chat attachments — proposed next feature

Decision: one chat application with multiple rooms and separate access rules. Longboard and ShortScout membership integration is still future work; SHORTSCOUT currently requires a Longboard admin account.

## First release proposal

Add **Attach file** beside GIF in the + menu. Also accept pasted clipboard images in the composer (requested September 16): show a removable draft preview and use the same validated private-upload flow as file selection. Pasting must not send immediately; preserve ordinary text paste when there is no supported image. Start with JPEG, PNG, WebP and PDF, up to 10 MB per file and three files per message. Show upload progress, a removable draft preview, image thumbnails and PDF filename/size download cards. Allow attachment-only messages. Keep DM attachments, videos, SVG/HTML/executables and document text indexing out of the first release.

## Data and storage

Use a private Supabase Storage bucket for bytes, behind a small application storage adapter. Keep attachment records in Postgres: id, uploader, room, message id, opaque object key, original filename, verified type/size, status, creation time. Never save expiring download URLs as permanent message content. Foreign keys tie published files to their source message; the database remains the source of truth for room permissions.

## Upload and send flow

1. A signed-in member chooses files. A server endpoint checks room access, pause state, allowed types, per-file/per-user quotas and proposed size, then creates pending records and scoped upload authorizations.
2. The browser sends bytes directly to private storage. File bytes do not pass through a Vercel route. Cancellation removes draft references; scheduled cleanup removes abandoned uploads.
3. Finalization verifies actual stored size and file signature, sanitizes display filenames, and holds files in quarantine until validation/scanning finishes. Declared MIME types alone are not trusted. Select a scanner before enabling PDFs; if unavailable, begin with validated/re-encoded images only.
4. Sending atomically attaches only the sender's ready, unused uploads from the same room to the new message. Recheck membership, room pause state and limits at this point. Retries use an idempotency key so they cannot duplicate a message or attach a file twice.
5. Readers request a download through the app. Recheck current room access and the linked message, then issue a short-lived signed URL. SHORTSCOUT files stay admin-only. Signed links are bearer links valid until expiry; use brief expiry, private caching and no permanent public links.
6. Message removal hides downloads immediately and enqueues storage deletion with retries. Access checks never rely on the object path alone. Storage cleanup is not a database cascade; the cleanup worker must delete the bytes explicitly.

## Extension points

The same attachment metadata and storage interface can later support DMs (conversation-member checks), new communities and webinars. Do not merge membership identities merely by matching email. Shared Social rules and account linking are separate from file storage.

Later: PDF/text extraction and search, videos, phone camera uploads, richer previews. File contents will not be sent to OpenAI in the first release. Preview text must render safely; downloads should use an appropriate content disposition.

## Acceptance checks

Test unauthorized room access, cross-room attachment IDs, another uploader's draft, revoked membership, expired URLs, forged types/sizes, retries, cancellation, orphan cleanup, deleted messages, and narrow/mobile layouts. Set storage quotas and observe bandwidth before raising limits.

Reference: [Supabase private storage access](https://supabase.com/docs/guides/storage/buckets/fundamentals).
