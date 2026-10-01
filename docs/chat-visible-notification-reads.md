# Clear Chat Notifications

Request: `e4af70b4-75ef-4398-9beb-47e166397265`

Reading a message in the room, replies, or a private conversation acknowledges the associated alerts without requiring a notification click. An acknowledgement contains at most 100 exact canonical message IDs, one room or conversation scope, and the independently observed mention and reaction event boundaries. It never uses a room message sequence to acknowledge a reaction. New or reactivated reactions after that snapshot remain unread.

The observer waits for a settled viewport in a visible, focused document. It excludes pending/deleted rows, offscreen or covered rows, open dialogs, search, and inactive Quad panes. Ordinary room reading does not require composer focus. Quad selection follows pointer, focus, wheel, or touch intent; passive automatic scrolling does not select a pane. Scrolling behavior and existing room/DM sequence markers are preserved.

All views share the existing activity subscription through `ChatActivityProvider`; no polling interval or scheduler is added. Failed acknowledgements retry on the next existing activity snapshot or relevant visibility/input event. Each batch rechecks visibility before dispatch. Successful acknowledgements invalidate the existing activity cache.

## Database and rollout

`20261001170041_chat_visible_notification_reads.sql` must follow Notification Formatting's `20261001170025_chat_notification_formatting.sql`. Its service-only `read_visible_chat_notifications` function rechecks account identity, room entitlement or DM participation, blocks, target scope, deletion, and independent event boundaries. Reaction eligibility uses Formatting's shared `eligible_chat_reaction_notifications` helper.

The old `read_visible_chat_room_alerts` signature becomes a no-op because its cursor cannot prove which targets were visible. Existing explicit bell item/all-read actions still use their separate read functions and remain functional during rollout. New room automatic reads advance only the existing room sequence marker. This migration adds no table, push fanout, or background job.

## Local verification

Integrated published Reactions Review `5c2245818c995d315a104a9d9a3a7efea97ac9b6` and Notification Formatting `0d998fe3194ff394a859969fe2a64ea8bf5157be`. The activity-route merge preserves the early exact-visible branch and the published manual reaction/all-read branches. Independent implementation, browser, and merge-resolution reviews found no remaining issues.

- `npm test`: 837 tests across 105 files passed, including activity route tests for scoped exact IDs, input bounds, identity, access, independent cursors, failed writes, and manual reaction/all-read compatibility.
- `node scripts/tests/chat-visible-notifications-database.mjs`: 35 assertions passed against the real Formatting and Clear migrations. Covers exact reply/room/DM targets, offscreen preservation, late/reactivated events, privacy, cursor/input validation, unchanged DM sequence markers, explicit manual actions, old-server compatibility, and denied client-role execution.
- `node scripts/tests/chat-visible-notifications-browser.mjs`: actual Next routes and the PGlite-backed fixture passed in both development and the final production build. Covers held old-event acknowledgement, unseen replies and nested replies, mobile overlay, search, offscreen DMs, modal coverage, fail-once stationary retry, active Quad selection, passive following, hidden document with a fresh event in its active pane, and mobile pane selection. No browser runtime errors occurred.
- Related database suites passed: 49 Formatting assertions and 56 Deletion assertions. Release-service regression suite: 71 tests passed.
- Combined Quad/Skip/Posting Links browser suite passed, including stale snapshots, hidden/background panes, manual scrolling, read markers, mobile selection, and deliberately failed fetch recovery. Full Reactions Review browser passed at 320, 390, and 1100px, including native hold, popup focus, pagination, scope, and cancellation.
- Formatting bell browser passed at 320, 390, and 1100px. Its actual production app/API/database browser passed real sends, event creation, bell/manual read, old-cursor reactivation, reply context, and deletion privacy with `CHAT_TEST_BASE_URL=http://localhost:3354`.
- TypeScript, whole-repository lint, and production build passed. Lint reports ten existing warnings outside this change and no errors. The release test's initial sandbox listener denial was resolved by allowing its synthetic loopback server; no source workaround was needed.

The local fixture uses only synthetic accounts and messages on ports 3354/54554. Final tests use the default repository path for the published Formatting migration. Its historical scrolling seed is dated a day earlier so real sends retain their normal rate-limit checks. Database assertions run sequentially in PGlite; they do not claim multi-session PostgreSQL concurrency coverage.

Evidence logs are `/tmp/clear-all-unit.log`, `/tmp/clear-db.log`, `/tmp/clear-formatting-db.log`, `/tmp/clear-deletion-db.log`, `/tmp/clear-release.log`, `/tmp/clear-browser-final.log`, `/tmp/clear-browser-production.log`, `/tmp/clear-quad-links-browser.log`, `/tmp/clear-formatting-browser.log`, `/tmp/clear-formatting-live-browser.log`, `/tmp/clear-reactions-browser.log`, `/tmp/clear-tsc.log`, `/tmp/clear-lint-final.log`, and `/tmp/clear-build.log`. Reviewed screenshots include `/tmp/clear-replies-mobile.png` and `/tmp/clear-quad-mobile.png`.

The coordinator registers and approves the final integrated commit. The dedicated release service remains the sole publisher and applies the production migration.
