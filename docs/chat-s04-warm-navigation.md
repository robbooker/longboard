# S04: recent conversation navigation

The account-level chat shell, update coordinator and inbox now survive room changes. Recently visited rooms and DMs render from bounded memory snapshots while the selected conversation refreshes in the background. Text/GIF drafts, room thread drafts and scroll positions survive navigation, including browser Back/Forward. Cold conversations keep their loading state until authorized data arrives.

The room cache holds five rooms for five minutes, at most80 confirmed messages and500 reactions per room. The DM cache holds six conversations for five minutes, at most300 messages each. Nothing is persisted across a full reload. Account change/logout clears private state; authoritative access denial clears cached and visible history. Room-specific polling mode follows the selected room. Existing server authorization and S03 idempotent sends remain in place.

Unsent attachment uploads still cancel when their existing composer unmounts. Attachment draft preservation is outside this change.

## Validation

- 549 unit tests across77 files passed, including account isolation, expiry, bounds and switching between realtime and fallback polling.
- TypeScript, targeted ESLint, production build and diff whitespace checks passed.
- Controlled local Chromium:20 warm room switches p95 **82.5ms**;20 warm DM switches p95 **88.4ms**. Actual batched history reads were delayed650ms. These measure return-to-cached-view latency, not production backend latency or first visits; no percentage improvement claimed.
- Real browser flows verified cold loading, room/DM drafts and scroll, thread restoration via browserBack, no room document/RSC navigation, mobile390px without horizontal overflow, and no browser errors.
- Synthetic DM403 cleared cached/visible private history; same-browser Alice→Mallory login did not retain Alice's messages or draft.
- Synthetic fixture only: no production messages, scans or AI calls used.

Browser harnesses: `scripts/tests/chat-s04-{room,dm,dm-identity}-browser.mjs`; fixture `chat-s04-fixture.mjs`. Browser/app port3282, fixture54482; fixture prints local startup configuration. Chromium executable `/usr/bin/chromium`.

Production publication still requires exact-version owner approval and the dedicated release service. No database migration.
