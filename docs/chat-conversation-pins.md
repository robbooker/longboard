# Conversation pins

Pin a room from Chat settings, or an accepted DM from its conversation settings. A labeled Pinned section appears above Your Communities in the sidebar and mobile navigation drawer. Each item has a pin indicator, an open button, and an accessible Unpin button. The single favorite feature remains independent.

Pins are saved for the signed-in chat account on the server, survive reloads and device changes, and retain insertion order regardless of new messages or conversations. Pinning an existing target is idempotent. Unpinning and repinning adds it to the end. Each account can save up to 50 targets.

`GET /api/chat/pins` returns visible pins; `POST` accepts `{action: 'pin' | 'unpin', target: {kind: 'room', room} | {kind: 'dm', conversationId}}`. The API verifies chat identity, checks mutation origins, ignores client account IDs and labels, and disables caching. The `chat_pins` service-only SQL function uses the existing `chat_favorite_target` access validator on writes and every read: only entitled rooms and accepted participant DMs with current membership and no block in either direction are returned. Unavailable pins remain saved but hidden; deleted conversations cascade away. Opens revalidate access before navigation. The sidebar also refreshes on focus, visibility, local pin changes, and explicit retry. Account rows are locked for mutations to enforce the cap across concurrent requests. No browser role can read the table or invoke the function.

## Verification

- `node scripts/tests/chat-pins-database.mjs`: isolated PGlite SQL permissions, account isolation, stable ordering, idempotency, cap, unpin, favorite independence, room revocation, DM participation/status/blocks/revocation and deletion.
- `node_modules/.bin/vitest run lib/__tests__/chatPinsRoute.test.ts`: authentication, origin, malformed input, trusted identity, safe label projection, unpin and safe errors.
- `node_modules/.bin/tsc --noEmit --incremental false`
- `node_modules/.bin/eslint app/api/chat/pins/route.ts components/chat/ChatPins.tsx lib/__tests__/chatPinsRoute.test.ts`
- `node scripts/tests/chat-pins-fixture.mjs` runs a synthetic database/protocol server on 54543. Start Next on 3343 with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54543`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key`, and `SUPABASE_SERVICE_ROLE_KEY=test-service-role`, then run `node scripts/tests/chat-pins-browser.mjs`. This uses actual Chromium, Next handlers and SQL with synthetic accounts only.

Deploy the additive migration through the dedicated release service before exposing the new API. No production data or schema is changed by these tests.
