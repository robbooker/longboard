# Skip Down Key

Ticket: `a8383592-3d30-4fdd-a63d-acfcafb82de2`.

A square down-arrow button immediately precedes Search in the shared room/DM header. Its title and accessible label are “Skip to Most Recent Message”. Quad panes put the same button beside expand, since that toolbar has no Search. Existing room types, Gainers popouts, and existing private conversations inherit the control; no new group conversation feature is introduced.

Room skips fetch uncached latest history before dropping the opening anchor, close search/replies, pin the viewport to the bottom, and refresh activity. Existing read-through logic acknowledges only the loaded sequence, capped by activity metadata. DM skips fetch the latest canonical page, clear the older-context gap, scroll to the bottom, and use the existing visible-message read API. Pending outgoing rows and drafts stay intact. Each session owns its DM callback; each quad pane registers its own handler. No global skip events or new read APIs are used.

Loading/opening guards prevent racing the initial unread snapshot. Failed latest loads retain the old position and unread boundary. Room requests are invalidated when the session, visibility, or view changes. DM requests check account, selection, liveness, and independent Skip ownership; background refreshes wait while the explicit skip is pending. Room and DM snapshots are retried when message revisions change before the response arrives. Retries are bounded at three attempts; continuous changes yield a retryable error without replacing newer data. DM cleanup releases its owned loading state even when a send acknowledgement advanced the message revision.

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


Race regression validation:

- The browser fixture holds a DM latest snapshot while a delayed send is acknowledged, then checks that Skip refetches, retains the canonical sent row, reaches the bottom, and clears loading.
- It also holds a room latest snapshot while a realtime insert and edit arrive, then checks that Skip refetches and preserves both changes.
- The expanded Skip browser suite, full 811-unit suite, 71 release tests, TypeScript, production build, send lifecycle browser suite, and actual production-build RETURN suite pass after these fixes. The build used `NODE_OPTIONS=--dns-result-order=ipv4first` after Google font downloads stalled on IPv6; no application configuration changed.

Published-base integration:

Published RETURN main commit `d460b43160407114f7223af70605797ee8090861` was merged into Skip without conflicts. The merge preserved the implementation tree exactly. Full 811-unit tests, 71 release-service tests, TypeScript, full lint (zero errors; ten pre-existing warnings), production build, mobile-send browser suite, expanded Skip race regressions, and actual production-build RETURN browser suite all pass on this published base. The only added release plan relative to published main is Skip's migration-free ticket plan. Validation used local synthetic data on ports 3347/54547; no push, registration, or publication was performed by this worker.

Release recovery on current published main:

Published Jammie main commit `c16496b3ee46bafbd6e283403faf461338879a1b` was merged cleanly after the earlier Skip release attempt stopped before merge. Skip implementation, browser regression, and release-plan files remain byte-identical to `2fa083819d0cc373eb8c38eda9e35c545db0c489`. Revalidation passes: 813 unit tests across 102 files, 71 release tests, TypeScript, full lint (zero errors; ten existing warnings), production build, mobile-send browser, Skip race browser, and actual production-build RETURN browser. The diff from published main adds only Skip's migration-free release plan. Build/release logs are `/tmp/skip-recovery-build.log` and `/tmp/skip-recovery-release.log`. The worker made no push, registration, release-record change, or publication; the coordinator must register the refreshed head and obtain fresh feature-page approval.
