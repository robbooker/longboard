# Notification Formatting

Ticket: `8e6d8961-bdd5-4e5f-a08d-2985d6ddc7cd`.

The chat bell presents location – name – action, followed by a main preview clamped to five lines. Reply context comes last in one italic line. Direct messages include the latest incoming unread message preview. Reaction alerts identify the actual reaction icon/type (including LB palm, SS lemon, DM thumbs-up, heart, laugh, and Rob) and the reacted-message preview. Names and message text remain plain escaped text; no link metadata or per-row content requests are added.

A new service-only, RLS-protected `chat_reaction_notifications` table records fresh reaction activations for the eligible message author, excluding self. It stores IDs, reaction type, timestamps and an independent sequence, without copied message bodies or names. Existing active reactions are not backfilled, repeated active writes do not revive read events, and removal followed by reactivation creates a new event ID/sequence. The table is separate from the existing mention/push queue; no push fanout or scheduler is introduced.

The activity projection joins current messages and profiles, excludes deleted content and blocked senders, and rechecks room entitlement or accepted DM participation. Deleted parent content is absent from reply context. Existing mention and DM counters/cursors retain their roles. Reaction alerts add optional `reactions`, `reactionCount`, and `reactionThrough`; explicit reaction reads never advance message read cursors. The old read RPC remains callable during rollout. See [the shared contract](chat-notification-contract.md) for exact schema, target scope and the separate Clear Chat Notifications observer contract.

The complete HTTP activity response is capped at 32 KiB serialized UTF-8. SQL initially bounds lists and preview/name lengths; the response then removes oldest listed rows until it fits, preserving complete counts and snapshot cursors. DM aggregation counts unread rows and finds their maximum sequence, then joins only that latest message for its preview rather than collecting unread bodies. The unit test uses emoji, CJK, quotes, backslashes and newlines to exercise byte and JSON escaping expansion.

Validation on published Reactions Review base `5c2245818c995d315a104a9d9a3a7efea97ac9b6`:

- `npm test`: 834 tests in 105 files.
- `node scripts/tests/chat-notification-formatting-database.mjs`: 49 assertions covering activation, idempotency, independent cursor boundaries, reactivation, author-only delivery, scoped targets, blocks/revocation, edited/deleted content, DM preview/counts, caps, grants, no push and no backfill.
- `node scripts/tests/chat-release-service-test.mjs`: 71 tests.
- `npx tsc --noEmit`, `npm run lint` (zero errors, ten existing unrelated warnings), and production build with synthetic local configuration.
- `node scripts/tests/chat-notification-formatting-browser.mjs`: actual bell/Next Image/CSS at 320, 390 and 1100px, five-line preview and context order, actual icons, escaped text, viewport bounds, read snapshots, keyboard close/focus, errors, and DM routing. Synthetic local transport only.
- `node scripts/tests/chat-notification-formatting-live-browser.mjs`: production Next app/API and synthetic PGlite database fixture, exercising message send, reaction event creation, real bell/manual read, reactivation against an old cursor, reply context, and deletion privacy.

The local production fixture uses `CHAT_FIXTURE_PORT=54553 CHAT_APP_PORT=3353 node scripts/tests/chat-notification-formatting-fixture.mjs`, and the app build/start uses `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54553 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key SUPABASE_SERVICE_ROLE_KEY=test-service-role NEXT_PUBLIC_SITE_URL=http://localhost:3353`. Its shared scrolling-history seed is dated a day earlier so the real send endpoint retains its unchanged rate-limit checks. Component and production browser servers share port 3353 and run sequentially.

Evidence logs are `/tmp/notification-formatting-{unit,db,release,tsc,lint,build,browser,live-browser}.log`; screenshots are `/tmp/notification-formatting-*.png`. Database tests use sequential PGlite; they do not claim multi-session PostgreSQL concurrency coverage. Chromium responsive/touch emulation is not a physical-device test. The parent independently reviewed the schema/API/UI and reran the DB suite; the Clear reviewer verified the shared migration/helper contract.

The release manifest contains the exact migration digest and marks the additive schema/optional API additions backward-compatible. This worker performed only local implementation, tests and commits. The coordinator owns push, registration, approval and the dedicated release-service workflow.
