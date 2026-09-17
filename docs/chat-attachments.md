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


## Current approved ticket — September 16

The saved revision 2 proposal supersedes the proposed type list above: PDF, JPEG, PNG and GIF, with malware scanning required before sharing. The old admin-only ShortScout note is obsolete; current verified room entitlements apply. Room and thread attachments are the first-release scope; the existing plan defers DMs.

### Implementation status

Approved request `e5f9aab7-f01d-4fb1-aa23-582ca5e1e411`, revision 2.

PDF, JPEG, PNG and GIF files, up to 10,000,000 bytes each. Validate filename, extension, declared MIME type, actual byte count and file signature. File signature validation is not malware scanning.

Planned flow: authenticated upload reservation → signed direct upload into private quarantine → server-side malware scan → immutable clean object → message attachment. A failed or unavailable scan must never produce a shareable file. Images render inline and PDFs show a download with filename and size. Every download checks current room membership or DM participation before issuing a short-lived storage URL. Attachment bodies do not pass through Vercel's 4.5 MB request limit.

Pending deployment dependency: select/connect a malware-scanning service. No existing scanner or storage bucket has been identified. Do not publish a bypass, label a signature check as a malware scan, or mark this ticket ready until the scanning flow is implemented and verified. No production schema/storage changes have been applied.

Current local work: isolated branch feat/chat-attachments, initial metadata/signature validation and tests, CLI-created pending migration 20260917030546_chat_attachments.sql. A scanner choice was requested from Rob while storage design proceeds.

### Checkpoint and remaining work

Initial local checks pass: metadata/type/size tests; PGlite migration execution; pending-file rejection, cross-room rejection, atomic binding, duplicate attachment rejection, client-role denial and metadata cascade; TypeScript and targeted lint. Storage bytes are not deleted by metadata cascades: an explicit cleanup queue/worker is still required before rollout.

Ticket is blocked on selecting/connecting the required malware scanner. This checkpoint is incomplete and must not be deployed: implement scanner finalization and immutable clean-object storage, authenticated downloads, upload UI/progress/removal and clipboard images, room/reply message fields and attachment-only sends, idempotent room sends, orphan/deletion cleanup, and full API/browser validation. The upload reservation endpoint deliberately rejects requests when scanner configuration is absent. It does not constitute a scanner implementation. No release registration or production schema change has occurred.


## Transloadit connection verified — 2026-09-17
- User created workspace booker-prod on Community/free and explicitly approved a dedicated Auth Key named Longboard chat attachment malware scanning, scoped only to assemblies:read and assemblies:write.
- Credentials are in ~/.config/transloadit/connection.env with mode 0600, outside the repository; variable names TRANSLOADIT_KEY and TRANSLOADIT_SECRET. Never copy values into handoff, logs or source. Production environment configuration remains pending release preparation.
- Implemented signed SHA-384 requests with 5-minute expiry, nonce, one-file/10MB limits and /file/virusscan error_on_decline=true. Results must be completed and match the uploaded file; error, timeout and incomplete results fail closed. Assembly capability URLs stay server-side.
- Live provider smoke test passed for a clean GIF and rejected the harmless standard EICAR antivirus fixture. No real member attachments submitted; free plan unchanged.
- Local validation/signing/result-check tests pass. Re-run live tests explicitly with: node --env-file=$HOME/.config/transloadit/connection.env --import tsx scripts/tests/chat-attachments-scanner-smoke.ts
- Scanner dependency resolved. Upload finalization, clean-object promotion, download authorization, cleanup, message integration, UI and full browser tests remain; uploads are not released.
