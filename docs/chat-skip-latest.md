# Skip Down Key

Ticket: `a8383592-3d30-4fdd-a63d-acfcafb82de2`.

A square down-arrow button immediately precedes Search in the shared room/DM header. Its title and accessible label are “Skip to Most Recent Message”. Quad panes put the same button beside expand, since that toolbar has no Search. Existing room types, Gainers popouts, and existing private conversations inherit the control; no new group conversation feature is introduced.

Room skips fetch uncached latest history before dropping the opening anchor, close search/replies, pin the viewport to the bottom, and refresh activity. Existing read-through logic acknowledges only the loaded sequence, capped by activity metadata. DM skips fetch the latest canonical page, clear the older-context gap, scroll to the bottom, and use the existing visible-message read API. Pending outgoing rows and drafts stay intact. Each session owns its DM callback; each quad pane registers its own handler. No global skip events or new read APIs are used.

Loading/opening guards prevent racing the initial unread snapshot. Failed latest loads retain the old position and unread boundary. Room requests are invalidated when the session, visibility, or view changes. DM requests check account, selection, liveness, and load generation; background refreshes wait while the explicit skip is pending.

Verification:

- `npx tsc --noEmit`
- Targeted ESLint on the five changed TSX files.
- Eight related Vitest files, 46 passing tests: activity route, message identity, opening, opening pagination, pending messages, quad layout/options, read recovery.
- `node scripts/tests/chat-skip-latest-browser.mjs`: real React components in Chromium with synthetic local API responses; anchored room and DM history, exact latest read markers, quad isolation, room/DM load failure, unchanged history, single-view DM wiring, Enter activation, 390/320px layouts and square geometry.
- Mobile screenshots `/tmp/skip-latest-390.png`, `/tmp/skip-latest-320.png`, `/tmp/skip-latest-dm-320.png`.

The browser fixture listens on assigned localhost port 3347 and never connects to production. No schema changes or production mutation are required. Revalidate after integrating RETURN TO MSG as directed by the coordinator. This local implementation does not constitute release approval or publication.

Combined validation after integrating RETURN TO MSG commit `add4ce85597499ddb560bf09ef2846ec08a7ada3`:

- All 811 unit tests across 102 files pass; all 71 release-service tests pass.
- TypeScript passes. Full lint has no errors and the ten existing unrelated warnings.
- Production build passes with synthetic Supabase URL `http://127.0.0.1:54547`, anon key `test-anon`, and service key `test-service-role`.
- Both `chat-mobile-send-browser.mjs` and `chat-skip-latest-browser.mjs` pass on the combined source.
- `CHAT_TEST_URL=http://localhost:3347 node scripts/tests/chat-return-message-browser.mjs` passes against the combined production build and `CHAT_FIXTURE_PORT=54547 CHAT_APP_PORT=3347 node scripts/tests/chat-recordings-fixture.mjs`.
- Relative to RETURN's commit, only Skip's migration-free release plan is added. RETURN remains the first release in the coordinator's publication order.
