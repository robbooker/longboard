# Private chat attachments

Members can attach PDF, JPEG, PNG and GIF files in room messages and thread replies. Choose **+ → Attach file**, use the thread’s Attach file button, or paste an image into the composer. Each message accepts up to three files, each no larger than 10,000,000 bytes. Attachment-only messages are supported. Images appear inline; all files have filename/size download links. DM attachments, video and file-content indexing are outside this release.

The draft shows upload progress, scanning status and a removable preview. Sending stays disabled until every selected file is ready. Failed files must be removed and selected again. Leaving a composer cancels its file drafts; text drafts retain their existing behavior. File contents are not sent to OpenAI. Transloadit processes files for malware scanning.

## Storage and authorization

1. The application verifies the signed-in identity, current room entitlement and room pause state. It validates the filename, MIME/extension pair and declared byte count. A persistent quota allows 100 reservations per member per UTC day; cancelling files does not reset it.
2. A signed URL uploads directly to a private Supabase quarantine path, avoiding Vercel’s inbound request-size limit. Clients have no direct storage or attachment-table policies. Quarantine objects are never downloadable through the app.
3. Finalization claims the upload once, checks actual byte size and file signature, then submits those bytes to Transloadit `/file/virusscan`. Signed SHA-384 requests expire in five minutes. A single matching completed scan result is required; rejection, outage or timeout leaves the file unshareable.
4. The exact scanned buffer is copied to a new server-only object path with upsert disabled and its SHA-256 recorded. The mutable quarantine object is never used as the shared file.
5. A database trigger binds only the sender’s ready files from that exact room to the message atomically. A sender/client UUID makes retries idempotent; reusing a key with different content fails.
6. Download routes recheck current room access and the linked message before issuing a 60-second private signed URL. PDFs always download; images may preview. Signed links remain bearer links until expiry. Filenames and permanent object paths are not placed in message bodies.
7. An hourly authenticated cleanup job deletes abandoned metadata after 24 hours and removes queued storage objects. Database deletion triggers preserve cleanup work for message/account deletion. Quarantine removal waits at least three hours, beyond the two-hour upload authorization, to prevent recreation through a still-valid URL. Clean-object deletion has a five-minute grace period for in-flight finalizers. Storage failures leave queue entries for the next run.

## Deployment

The migration `20260917030546_chat_attachments.sql` is additive/backward-compatible and must be applied from the exact approved PR **before** its app deployment. It creates the private bucket, metadata/quota/deletion tables and binding/send functions, then relaxes the message body check only for messages with attachments. No production migration has been applied during development.

Required server-only production secrets: `TRANSLOADIT_KEY` and `TRANSLOADIT_SECRET`. The dedicated `booker-prod` key has only `assemblies:read` and `assemblies:write`. Local credentials are outside the repository at `~/.config/transloadit/connection.env` (0600); never print or commit values. Vercel secret-variable configuration requires the pending explicit credential-transfer approval. Existing `CRON_SECRET` must authorize `/api/cron/chat-attachments` (hourly at minute 17). No paid-plan change is required; scanning fails closed if the free allowance is exhausted.

Before merging, verify the secrets are configured, apply the exact approved migration, inspect bucket privacy and service-only grants, and smoke-test an authorized clean upload. After deployment verify the exact merge commit is READY on both Longboard domains and confirm a live upload/reply/download and rejected upload. Do not mark published on merge alone.

## Verification

- `npm test`: 323 tests pass, including file metadata/signature validation, scanner signing/result evidence, immutable-byte promotion, rejection/outage behavior, ownership, room access, cancellation and short-lived downloads.
- `node scripts/tests/chat-attachments-database.mjs`: private binding, cross-room denial, attachment-only messages, duplicate/conflicting retry protection, cleanup queue grace periods and cancellation-resistant quota.
- `node scripts/tests/chat-attachments-browser.mjs`: isolated real application routes with PGlite/storage fixtures and a synthetic scanner preload; file menu, upload/scanning states, 320/390/768/1440px layouts, send/reload/download, threaded replies, malware/type rejection and clipboard draft/removal. Chromium only; physical iOS/Android and Safari testing remain a manual post-review check.
- ShortScout-only browser verification passes upload, post, server-history reload and download, and denies Longboard room access.
- Existing mobile header browser suite passes with the new controls.
- Real provider test independently passed a clean GIF and rejected the harmless EICAR antivirus fixture. Run explicitly with `node --env-file=$HOME/.config/transloadit/connection.env --import tsx scripts/tests/chat-attachments-scanner-smoke.ts`. This consumes real scanner quota; it is not part of the automated suite.
- TypeScript and targeted ESLint pass. Production build passed with only existing unrelated lint warnings.

The synthetic scanner preload is under `scripts/tests/` and must never be enabled in a deployment. There is no production scanner bypass.

## Clipboard image follow-up (PASTE IMAGE)

Pasting JPEG, PNG or GIF files into a room or thread composer uploads them as scanned drafts. Press Send to share them inline; pasting never immediately posts a message. Normal text and links retain native paste behavior. Browsers exposing only `clipboardData.files` are supported as a fallback to clipboard items, without duplicating files. Unnamed images receive an appropriate filename.

Unsupported clipboard files show format guidance and direct PDF users to Attach file. Unreadable clipboard file data suggests saving the image and using Attach file. Upload/scanner errors stay visible on the removable draft and block sending until removed. If a browser or operating system exposes no file at all, use Attach file; the app does not request background clipboard permission or fetch remote HTML images.

Validation adds six clipboard extraction tests and browser checks for ordinary-text paste, unsupported formats, files-only fallback, room paste/send/reload, thread paste/send and upload failure. Browser execution covers Chromium; physical Safari/iOS clipboard integration still needs device verification.
