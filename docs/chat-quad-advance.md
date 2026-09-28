# Quad View Message Advance

Ticket: `72e156de-9491-4079-99a0-f5bbc5675f5d`.

Visible room and DM panes follow incoming messages when their own viewport is at the bottom, independently of keyboard focus. Both views observe late content growth, such as loaded attachments, and pane/document visibility changes. Room positioning now runs before paint. None of these operations focuses the pane or composer.

Wheel, touch, keyboard scrolling, and upward viewport navigation suspend following. Reaching the bottom (within two pixels for rounding) resumes it; the explicit Skip control also resumes following. The last automatic scroll offset distinguishes delayed scroll events and browser anchoring from deliberate upward navigation. Without that distinction, an event queued before media growth could see the enlarged content and incorrectly disable following.

Hidden, zero-size, offscreen, and background-document panes cannot perform automatic scroll writes or change follow intent from misleading scroll geometry. When revealed, a previously following pane catches up; a manually suspended pane retains that state. Existing unread opening anchors remain intact. Hash/deep-link navigation suspends following before changing the viewport. Existing room/DM read authorization and visibility predicates, Skip fetch/race guards, and RETURN send-focus guards remain unchanged. No global pane-selection event or focus-dependent scrolling was introduced.

Validation commands:

- `npm test` — 811 tests in 102 files.
- `npx tsc --noEmit`.
- `npm run lint` — no errors; ten existing unrelated warnings.
- `node scripts/tests/chat-release-service-test.mjs` — 71 tests.
- `CHAT_TEST_PORT=3349 node scripts/tests/chat-skip-latest-browser.mjs --quad-advance` — actual room, DM, and Quad React components with isolated synthetic transport. Covers four visible panes while focus remains in one, late media growth, small/manual scroll suspension, returning to bottom, hidden pane scroll-write/read safety, reveal, simulated document visibility, mobile tabs, Skip interaction/races, and hash navigation.
- `node scripts/tests/chat-mobile-send-browser.mjs` — existing RETURN/mobile lifecycle regression.
- Production build and `CHAT_TEST_URL=http://localhost:3349 node scripts/tests/chat-return-message-browser.mjs`, using `CHAT_FIXTURE_PORT=54549 CHAT_APP_PORT=3349 node scripts/tests/chat-recordings-fixture.mjs`.

Build/start configuration uses only synthetic values: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54549 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key SUPABASE_SERVICE_ROLE_KEY=test-service-role NEXT_PUBLIC_SITE_URL=http://localhost:3349`. Run `npm run build`, then `npm run start -- --port 3349` with that configuration. The component fixture and production server share port 3349 and must run sequentially.

Browser coverage is Chromium at desktop and responsive mobile widths. Physical iOS/Android keyboards are not device-tested. No migrations, permissions, or release-service changes are needed. This branch is based on the tested Skip integration after published RETURN; integrate after Skip.
