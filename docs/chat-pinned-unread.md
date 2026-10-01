# Pinned Chat — Unread Messages

Ticket: `e5fc56f0-5068-4338-acd3-ea7cd3cc4b6e`. Initial published base: `dbb4af397e49f25399b9ba70f8f6d589e2c90b76`. Final integrated published main: `12bd333ed10cf75c9f3df7b13ebdd372acc4774b` (Attachments PR #355).

The existing pinned conversation list shows an unread badge for entitled rooms and available accepted DMs. Zero, unavailable, failed activity reads, and unknown counts have no badge. Counts above 99 display `99+`; the button's accessible description retains the full count. Labels wrap independently from the badge and Unpin button on desktop and mobile.

Room pins reuse the existing complete `roomMessageCounts`. The activity projection adds optional `pinnedDmUnread: Record<conversation UUID, nonnegative integer>`, with explicit zero for each authorized accepted pinned DM and at most 50 entries. It is computed from the full incoming-message aggregates before the notification preview limit. A DM omitted from `dms` can still have unread messages. Older servers may omit the entire map; the UI treats that as unknown and never substitutes a preview count.

The SQL joins only the actor's saved pins and participant conversations. It preserves strict actor `chat_account_has_room`, accepted status, bilateral block filtering, and the other participant's existing non-granting `chat_account_room_recipient_eligible` policy, matching `chat_pins`/`chat_favorite_target`. Own messages, deleted messages, and messages at or below the existing DM read sequence do not count. The projection stores nothing and changes no read marker, notification cursor, authorization rule, or pin/navigation action.

The existing shared activity provider and coordinator carry the new field. Rendering adds no fetch or timer. A successful Pin/Unpin action invalidates the same shared activity resource. The complete serialized UTF-8 activity response remains capped at 32 KiB; the validated 50-entry map survives preview trimming. The worst-case unit fixture combines all 50 UUIDs, maximum safe integer counts, emoji/CJK text, quotes, backslashes and newlines.

Quad retains its existing layout, which has no pinned sidebar. Coverage verifies arrival and reading inside Quad update the same unread truth, then checks the badges in the existing Single/mobile pinned list. No Quad pin panel or picker decoration is added.

## Validation

- `node scripts/tests/chat-pinned-unread-database.mjs`: 28 assertions covering explicit zero, arrivals, read cursors, deletion, unchanged markers, more than 100 unread conversations with the pinned preview omitted, 50 pins, account isolation, participants, blocks, accepted status, recipient access loss, strict SS actor expiry, offline recipient eligibility and grants.
- The existing pins database suite, Formatting's 49 assertions, visible notification reads' 35 assertions, ShortScout authorization's 105 assertions, and attachment-only sending's 69 assertions pass unchanged.
- Full unit suite: 872 tests in 107 files, including the complete 32 KiB count-map budget and a delayed old activity response after account reset on the same resource path.
- The actual Next/API/PGlite browser suite exercises realtime room/DM badges; opening/reading; zero, errors and old-server omission; `99+`; previews beyond SQL and HTTP limits; unpin/re-pin; blocks and access revocation; 1440px desktop, 320/390px mobile drawer, and Quad read integration. It also holds an old activity response during real local Supabase sign-out, releases it after session clear, and signs in as another account in the same browser context without restoring the old pins/counts. It uses synthetic accounts/data and the existing fixture's realtime adapter.
- TypeScript passes. ESLint has zero errors and ten existing unrelated warnings. The release-service test suite passes all 71 tests, including the local HTTP redirect fixture.
- The production Next build passes with synthetic local configuration; the complete browser suite also passes against that built bundle.

The self-contained local fixture runs on port 54557 with `CHAT_FIXTURE_PORT=54557 CHAT_APP_PORT=3357 node --import tsx scripts/tests/chat-pinned-unread-fixture.mjs`; the app runs on port 3357 with synthetic Supabase configuration. No production data, sessions or credentials are used. Browser screenshots are `/tmp/chat-pinned-unread-desktop.png` and `/tmp/chat-pinned-unread-mobile-{320,390}.png`; logs use `/tmp/chat-pinned-unread-*.log`, including the complete production-bundle run in `/tmp/chat-pinned-unread-production-browser.log`. PGlite is sequential; these read-only projection tests do not claim native PostgreSQL multi-session concurrency coverage. Chromium responsive emulation is not a physical-device test.

## Published-main integration

After the coordinator verified Attachments PR #355 published, its actual merge `12bd333ed10cf75c9f3df7b13ebdd372acc4774b` was merged cleanly into the reviewed Pins implementation `044b0688516d062b19540e2312a6a7373515bb41`, producing local integration commit `d13b16fc8e760c19f6e1bd8e919c49a19875c73a`. The prerequisite adds only its release manifest, documentation, and three regression scripts. It makes no runtime or schema change; the Pins implementation and migration digest remain unchanged.

All database suites listed above, 872 units, TypeScript, ESLint, 71 release-service tests, and the production build were rerun on that integration. The full Pins browser matrix passed against the newly built production bundle, including mobile layouts and the held old response during real logout/account replacement. Logs for this final run use `/tmp/chat-pinned-unread-integrated-*.log`.

The prerequisite's complete attachment browser regression also passed against that production bundle with the Pins migration added to the synthetic current-schema fixture: 19 sends across LB/SOCIAL/SS, replies, accepted DMs, mobile and Quad, exact downloaded bytes and thumbnails, scan/send retry gates, and strict SS denial after a source downgrade, with zero browser errors. Temporary local copies changed only the test ports to 3357/54557 and appended the Pins migration to the fixture; the synthetic scanner/source preload was never used outside this local run. The browser log is `/tmp/chat-pinned-unread-integrated-attachments-browser.log`.

## Release contract

The migration only replaces the existing activity function to add an optional bounded projection. Its existing signature, grants, counters, cursors and preview fields remain compatible with the published application. New clients on older servers omit DM badges until the map is available. The release manifest records the exact migration digest with `backwardCompatible: true`.

This worker implements, validates and commits locally. The coordinator owns current-main integration confirmation, push, PR registration, exact-version authorization, the dedicated release service and live verification. No release-service safeguards are changed.
