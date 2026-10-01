# Clear Chat Notifications

Request: `e4af70b4-75ef-4398-9beb-47e166397265`

Reading a message in the room, replies, or a private conversation acknowledges the associated alerts without requiring a notification click. An acknowledgement contains at most 100 exact canonical message IDs, one room or conversation scope, and the independently observed mention and reaction event boundaries. It never uses a room message sequence to acknowledge a reaction. New or reactivated reactions after that snapshot remain unread.

The observer waits for a settled viewport in a visible, focused document. It excludes pending/deleted rows, offscreen or covered rows, open dialogs, search, and inactive Quad panes. Ordinary room reading does not require composer focus. Quad selection follows pointer, focus, wheel, or touch intent; passive automatic scrolling does not select a pane. Scrolling behavior and existing room/DM sequence markers are preserved.

All views share the existing activity subscription through `ChatActivityProvider`; no polling interval or scheduler is added. Failed acknowledgements retry on the next existing activity snapshot or relevant visibility/input event. Each batch rechecks visibility before dispatch. Successful acknowledgements invalidate the existing activity cache.

## Database and rollout

`20261001170041_chat_visible_notification_reads.sql` must follow Notification Formatting's `20261001170025_chat_notification_formatting.sql`. Its service-only `read_visible_chat_notifications` function rechecks account identity, room entitlement or DM participation, blocks, target scope, deletion, and independent event boundaries. Reaction eligibility uses Formatting's shared `eligible_chat_reaction_notifications` helper.

The old `read_visible_chat_room_alerts` signature becomes a no-op because its cursor cannot prove which targets were visible. Existing explicit bell item/all-read actions still use their separate read functions and remain functional during rollout. New room automatic reads advance only the existing room sequence marker. This migration adds no table, push fanout, or background job.

## Local verification

- `npm test`: 833 tests across 104 files passed before final integration, including eight activity route tests for scoped exact IDs, input bounds, identity, access, independent cursors, and failed writes.
- `node scripts/tests/chat-visible-notifications-database.mjs`: 35 assertions passed against the real Formatting and Clear migrations. Covers exact reply/room/DM targets, offscreen preservation, late/reactivated events, privacy, cursor/input validation, unchanged DM sequence markers, explicit manual actions, old-server compatibility, and denied client-role execution.
- `node scripts/tests/chat-visible-notifications-browser.mjs`: actual Next routes and the PGlite-backed fixture passed. Covers held old-event acknowledgement, unseen replies and nested replies, mobile overlay, search, offscreen DMs, modal coverage, fail-once stationary retry, active Quad selection, passive following, hidden document with a fresh event in its active pane, and mobile pane selection. No browser runtime errors occurred.
- TypeScript and targeted lint passed. Final whole-repository lint/build and combined regressions follow integration of the published prerequisite commits.

The local fixture uses only synthetic accounts and messages on ports 3354/54554. Before Formatting is integrated, `CHAT_FORMATTING_MIGRATION` can point to its real migration for local testing. After integration the default repository path is used. Evidence logs are `/tmp/clear-all-unit.log`, `/tmp/clear-unit.log`, `/tmp/clear-db.log`, `/tmp/clear-browser.log`, `/tmp/clear-tsc.log`, and `/tmp/clear-lint.log`. Screenshots include `/tmp/clear-replies-mobile.png` and `/tmp/clear-quad-mobile.png`.

The coordinator registers and approves the final integrated commit. The dedicated release service remains the sole publisher and applies the production migration.
