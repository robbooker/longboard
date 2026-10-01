# Delete in Replies

Request: `4a25c82b-43dc-4438-aa70-0609c85249a8`

Members can immediately delete their own room messages, replies, and private messages. A room message with surviving replies keeps its author, timestamp, stable ID, and conversation position with the body “Message deleted.” A room leaf disappears; deleted ancestors disappear when their final surviving child is removed. Flat private messages disappear as whole rows for both participants. Existing administrator moderation remains separate.

The owner can edit a retained room tombstone. Its editor starts empty and saves only a deliberate replacement. Deletion erases the prior body, attachments, reactions, mentions, embeddings, and pending Buddy work. Replacement cannot recover old content or attachments. Removed rows have no visible menu or undo history.

## Data and compatibility

`supabase/migrations/20261001161221_chat_delete_replies.sql` adds `deleted_at`, `removed`, and `revision` to `longboard_chat_messages`. Existing DM tombstones are retained. Message/client IDs and read sequences remain stable. The migration also updates room deletion/editing, thread counts, unread counts, inbox previews, search/context, reply insertion, reactions, and Buddy processing.

`change_chat_message` accepts an optional eighth revision argument. Existing seven-argument callers can still edit live messages and delete their own messages. An explicit matching revision is required to replace a retained tombstone, so an old editor cannot restore deleted content accidentally. The new application must deploy after the migration. The exact migration digest is recorded in `.release/4a25c82b-43dc-4438-aa70-0609c85249a8.json`:

`9ccca66d7eba4455b80492eadf5480661e26665c0e8c1237a961b59c3dee468e`

Room history and thread reads hide removed rows while accepting up to 200 previously seen IDs to return canonical removal evidence. Clients retain that evidence outside the rendered conversation and reject older send responses by revision. This covers deletion in another session that is learned through polling. Quad update batches respect the existing 32 KiB request limit even with eight large reconciliation paths.

Room mutation, reply insertion, and Buddy work acquire ancestor locks before the source message. Reaction writes lock and recheck the target before creating a reaction. Administrator hard deletion still prunes empty deleted ancestors. These lock orders were independently reviewed; the local database fixture runs sequentially and does not prove concurrent PostgreSQL behavior. No local PostgreSQL server was available for a controlled multi-session database test.

## Validation

Integrated published Quad `8fcb4c7921fa329ad07a8d75d59ffbd60b6da8d1` and Posting Links `30501b60374d02f4d5cedd3df719706fc655e6bc`. The integrated implementation received an independent review with no remaining findings.

- `npm test`: 830 tests across 104 files passed.
- `node scripts/tests/chat-delete-replies-database.mjs`: 56 PGlite assertions passed, covering ownership, stable IDs/sequences, idempotent removal, revision conflicts, replacement, nested/admin pruning, deleted search/context filtering, content cleanup, Buddy completion, paused-room deletion, DM projections, and grants. An independent invocation also verified old seven-argument edit/delete compatibility.
- `node scripts/tests/chat-delete-replies-browser.mjs`: actual local Next routes and PGlite-backed API passed at 1440px and 390px. Covers immediate room/reply deletion, retained root/replies, empty editing and replacement, draft preservation, persistence, ownership, whole-row DM disappearance for sender and recipient, and held successful room/thread send responses after another session deletes the row and polling learns the deletion. No browser runtime errors occurred.
- `node scripts/tests/chat-skip-latest-browser.mjs --quad-advance --posting-links`: combined actual-component browser suite passed, including held stale snapshots with known IDs, independent panes/drafts, manual scrolling, following new messages, hidden/mobile panes, link previews, read markers, keyboard interaction, and failed-fetch recovery. Two deliberate 503 responses test recovery.
- `npx tsc --noEmit`: passed. `npm run lint`: no errors; 10 existing warnings outside this change.
- `npm run build -- --debug`: production build passed with synthetic local service configuration. The initial sandbox attempt returned a generic webpack failure; the normal-access build completed without changing dependencies or application code.

Local evidence is in `/tmp/delete-all-unit.log`, `/tmp/delete-db.log`, `/tmp/delete-browser-final.log`, `/tmp/delete-quad-links-browser.log`, `/tmp/delete-tsc-final.log`, `/tmp/delete-lint-final.log`, and `/tmp/delete-build.log`. Reviewed screenshots include `/tmp/delete-thread-390.png` and `/tmp/delete-dm-390.png`. Fixtures use synthetic accounts and messages; no production changes were made.

The coordinator must register and approve the final exact commit, then use the dedicated release service for hosted checks, production migration, publication, and live verification.
