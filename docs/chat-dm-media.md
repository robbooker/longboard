# GIFs and files in DMs

Ticket: `36b17041-4053-494d-9479-5e17a41a9cf3`.

Direct messages reuse the room GIF library and scanned PDF/JPEG/PNG/GIF upload flow (three files, 10 MB each). GIF search and pasted GIPHY links work in initial message requests. Files become available after the conversation is accepted, with an explanatory note in the request composer. Images use the shared full-size preview; PDFs download. Empty-caption file messages show `[Attachment]` in the sidebar. Captions can be edited without changing the files.

Private file operations derive identity from the authenticated account. Reservation and finalization require an accepted, unblocked conversation. Metadata and download/preview require participation plus a matching live DM message containing the file ID; room queries cannot return DM files. Cancellation is owner-only and remains possible when blocked. Sends atomically bind only scanned, owned files from the same conversation and retain existing DM rate limits, unread sequence behavior, and retry identity. The database functions are service-role-only and use an empty search path.

Deleting a DM removes its attachment metadata, queues both quarantine and scanned objects through the existing delayed cleanup, and retains only attachment UUIDs on the tombstone to reject/reconcile retries without resurrecting content. New preview/download requests immediately fail. Previously issued storage URLs can remain valid for their existing 60-second lifetime; cleanup uses the existing five-minute scanned-object grace. Abandoned drafts retain the existing orphan cleanup policy.

## Rollout

Apply `20260918001755_chat_dm_media.sql` before deploying this application change. It extends the existing private attachment table and DM message shape and replaces the DM edit/inbox functions to preserve files on edits and show file-only previews. Existing text-only clients remain compatible. Use the existing configured malware scanner and attachment cleanup job; no new bucket, secrets, public storage policy, or scheduler is needed. GIPHY search uses the existing public client key and paste-link fallback.

The UI requires the shared `ChatImagePreview` component from screenshot-view commit `733d61cc80de74f95c85b50a1351477c9bc97b6e`; those shared files are owned by that change. No production migration or deployment was performed by this worker.

## Verification

- `node scripts/tests/chat-dm-media-database.mjs`: 28 assertions covering pending/outsider reservations, scanner binding and rollback, cross-conversation/room/owner substitution, duplicate files, attachment-only preview, retries and conflicts, caption edits, blocked sends, deletion cleanup, and role grants.
- `node scripts/tests/chat-dm-message-actions-database.mjs`: existing 34 edit/delete assertions pass.
- Targeted Vitest attachment, DM mutation, validation and cleanup suites: 48 tests pass.
- `npx tsc --noEmit`, targeted ESLint and `git diff --check` pass. Production build passes with only pre-existing unrelated lint warnings.
- Browser test uses desktop 1440 and mobile 390 with Alice, Bob and outsider Mallory. It checks scanned image/PDF send, recipient image enlargement/Escape, file-only sidebar preview, outsider and public-room isolation, caption preservation, GIF search/choose/insert/Enter/play, tombstone access revocation, reload, and mobile overflow.

For reproduction, run `node scripts/tests/chat-dm-media-fixture.mjs` (isolated synthetic database/storage on 54424), then start the app on 3224 with synthetic Supabase credentials and the existing test scanner preload:

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54424 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon SUPABASE_SERVICE_ROLE_KEY=test-service-role TRANSLOADIT_KEY=test-key TRANSLOADIT_SECRET=test-secret CHAT_TEST_SCANNER=isolated-fixture NEXT_PUBLIC_GIPHY_API_KEY=test-key NODE_OPTIONS='--require ./scripts/tests/chat-attachments-scanner-fixture.cjs' npm run dev -- --port 3224
node scripts/tests/chat-dm-media-browser.mjs
```

The browser supplies deterministic GIPHY responses; the scanner preload supplies deterministic clean/virus results. These test-only settings must never be used in a deployment. Screenshots are written to `/tmp/dm-media-desktop.png`, `/tmp/dm-media-mobile.png`, and `/tmp/dm-media-mobile-viewer.png`.
