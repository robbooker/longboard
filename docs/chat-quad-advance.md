# Quad View Message Advance

Ticket: `72e156de-9491-4079-99a0-f5bbc5675f5d`.

Visible room and DM panes follow incoming messages when their own viewport is at the bottom, independently of keyboard focus. Both views observe late content growth, such as loaded attachments, and pane/document visibility changes. Room positioning now runs before paint. None of these operations focuses the pane or composer.

Wheel, touch, keyboard scrolling, and upward viewport navigation suspend following. Reaching the bottom (within two pixels for rounding) resumes it; the explicit Skip control also resumes following. The last automatic scroll offset distinguishes delayed scroll events and browser anchoring from deliberate upward navigation. Without that distinction, an event queued before media growth could see the enlarged content and incorrectly disable following.

Hidden, zero-size, offscreen, and background-document panes cannot perform automatic scroll writes or change follow intent from misleading scroll geometry. When revealed, a previously following pane catches up; a manually suspended pane retains that state. Existing unread opening anchors remain intact. Hash/deep-link navigation suspends following before changing the viewport. Existing room/DM read authorization and visibility predicates, Skip fetch/race guards, and RETURN send-focus guards remain unchanged. No global pane-selection event or focus-dependent scrolling was introduced.

Validation commands:

- `npm test` — 813 tests in 102 files on the published Skip base.
- `npx tsc --noEmit`.
- `npm run lint` — no errors; ten existing unrelated warnings.
- `node scripts/tests/chat-release-service-test.mjs` — 71 tests.
- `CHAT_TEST_PORT=3349 node scripts/tests/chat-skip-latest-browser.mjs --quad-advance` — actual room, DM, and Quad React components with isolated synthetic transport. Covers four visible panes while focus remains in one, late media growth, small/manual scroll suspension, returning to bottom, hidden pane scroll-write/read safety, reveal, simulated document visibility, mobile tabs, Skip interaction/races, and hash navigation.
- `node scripts/tests/chat-mobile-send-browser.mjs` — existing RETURN/mobile lifecycle regression.
- Production build and `CHAT_TEST_URL=http://localhost:3349 node scripts/tests/chat-return-message-browser.mjs`, using `CHAT_FIXTURE_PORT=54549 CHAT_APP_PORT=3349 node scripts/tests/chat-recordings-fixture.mjs`.

Build/start configuration uses only synthetic values: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54549 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key SUPABASE_SERVICE_ROLE_KEY=test-service-role NEXT_PUBLIC_SITE_URL=http://localhost:3349`. Run `npm run build`, then `npm run start -- --port 3349` with that configuration. The component fixture and production server share port 3349 and must run sequentially.

Browser coverage is Chromium at desktop and responsive mobile widths. Physical iOS/Android keyboards are not device-tested. No migrations, permissions, or release-service changes are needed. This branch includes published RETURN and Skip.

Published-main integration on October 1, 2026:

Published Skip commit `f7b6d1be038232fa0726dd4c37af654d373e81c2` was integrated locally as merge `80ff2d9`. The squash ancestry caused conflicts in the earlier Skip files; published Skip's implementation was verified byte-identical to the prior `2fa0838` base, so the Quad implementation was retained exactly and current-main Skip evidence was preserved. The diff from published main contains only this seven-file Quad change, including its migration-free release plan.

All 813 unit tests, 71 release-service tests, TypeScript, full lint (zero errors; ten existing warnings), production build, Quad/Skip browser regressions, mobile-send lifecycle browser suite, and actual production-build RETURN browser suite pass after integration. Browser checks used synthetic data on ports 3349/54549, with no page errors. Logs are `/tmp/quad-advance-unit.log`, `/tmp/quad-advance-release.log`, `/tmp/quad-advance-tsc.log`, `/tmp/quad-advance-lint.log`, `/tmp/quad-advance-build.log`, `/tmp/quad-advance-browser.log`, `/tmp/quad-advance-mobile-send.log`, and `/tmp/quad-advance-return-browser.log`.

Compatibility contract: there are no message schema or API changes. Canonical message IDs remain the row, deep-link, and read-boundary identity; the helper tracks viewport geometry without assigning message identity. Composer or message-preview resizing is observed through pane/row layout, and message deletion reruns the existing message-driven effect. These layout changes retain the existing room/DM read authorization and visibility predicates. Posting Links and Delete in Replies must preserve those IDs and predicates when integrating their overlapping components.

This worker performed no push, release registration, release claim, production migration, deployment, or publication. The coordinator handles the exact refreshed version through the dedicated release service after hosted checks.
