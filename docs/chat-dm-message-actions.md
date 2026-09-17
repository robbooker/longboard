# Edit and delete private messages

Approved request: `59a6e327-744d-4419-8817-0073a5bba93e`.

A member's own, non-deleted DM has the existing room-style ••• menu. Edit opens a focused dialog with Save/Cancel, Enter to save and Shift+Enter for a newline; saved messages show “edited”. Delete requires confirmation and replaces the body with “Message deleted” for both participants. The tombstone retains the message ID, sender, original timestamp, sequence and send-idempotency key. Edited/deleted timestamps and a revision counter support safe reconciliation. No original body is retained in the message row after delete; ordinary database backups retain their existing lifecycle. DMs are not included in room search or room-summary generation. Existing user-written report reasons are unchanged.

Only the verified sender may mutate a message, and the server requires its conversation ID as well. No admin override is added. System summary messages have no action menu and their system-thread identifier is rejected. Pending outgoing requests can be edited; blocked or declined conversations cannot be edited. A sender can still delete their own messages in those conversations. Revision checks reject conflicting edits or a delete based on stale content. Exact edit retries and repeated deletes are idempotent; deleted messages cannot be edited or resurrected by replaying the original send.

The service-only invoker RPC uses the same actor → participant-pair → conversation lock ordering as send/block operations. Existing table RLS and browser read-only grants are preserved; new function execution is revoked from PUBLIC/anon/authenticated and granted only to service_role. The API derives account identity from the verified session and validates IDs, revision and body length. Responses do not expose internal SQL errors.

Realtime UPDATE events and the existing foreground poll refresh mutations. In addition to the latest 50 messages, previously loaded history is refreshed in batches of at most 100 message IDs, after participant validation, so old paged messages cannot retain edited/deleted text. Revision-aware merging ignores older responses. Latest-message sidebar previews automatically reflect the updated stored body; tombstones keep existing read sequences valid.

## Deployment dependency

Apply `20260917231136_chat_dm_message_actions.sql` before deploying the app because history GET now selects its new columns. The file was generated with `supabase migration new`. No production migration has been applied by the implementation worker. Older application versions can still read the additive schema and display the tombstone's literal body. No new environment variables are required.

## Verification

- `node scripts/tests/chat-dm-message-actions-database.mjs`: 34 assertions covering sender/recipient/outsider and cross-conversation authorization, stale revisions, exact retries, blocked/declined behavior, tombstones, original-send replay, sidebar preview, read sequence, invoker/search-path metadata and denied direct writes/RPC execution.
- `npx vitest run lib/__tests__/chatDmMessageActionsRoute.test.ts`: 16 API tests.
- `npx vitest run lib/__tests__/chatInboxRoute.test.ts -t 'private inbox API boundary'`: 11 existing boundary tests pass. The unrelated summary entitlement mocks are not changed.
- `node scripts/tests/chat-dm-message-actions-browser.mjs`: isolated two-account Chromium flow covering own-only menus, stale-editor error/draft retention, recipient polling for edits/deletes beyond the latest history page, edited marker, reload, latest preview updates, tombstone link removal, delete cancellation/confirmation, desktop/mobile dialogs, Enter/Shift+Enter/Escape and focus restoration, and system protection.

For the browser check, copy `scripts/tests/chat-mobile-fixture.mjs` alongside itself to a temporary ignored/local file, replace fixture/app ports 54404/3204 with 54424/3224, and load the new migration before starting its HTTP server. Use `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54424 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon SUPABASE_SERVICE_ROLE_KEY=test-service-role npm run dev -- --port 3224`. The browser script accepts CHAT_TEST_URL/CHAT_FIXTURE_URL overrides; restart the synthetic fixture before each run. No production credentials or real member messages are used. PGlite validates database behavior/grants locally; production advisors are intentionally not invoked.

Browser evidence: `/tmp/chat-dm-actions-browser.log`, `/tmp/chat-dm-edit-desktop.png`, `/tmp/chat-dm-delete-mobile.png`. This exercises foreground polling rather than a real Supabase WebSocket service.

TypeScript, targeted ESLint, `git diff --check`, and production build pass. The build includes existing unrelated lint warnings; output is `/tmp/chat-dm-actions-build.log`. The dev server was stopped before building, and both isolated servers are now stopped. No production migration, deployment, or release registration was performed by this worker.
