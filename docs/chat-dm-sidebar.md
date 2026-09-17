# DMs in the sidebar

Approved request: `5c31d5fd-65d8-4e31-8e7f-715f6635fb67`.

The existing chat navigation contains one **DMs** section with named ongoing conversations, incoming requests, previews, and unread counts. Selecting a conversation displays it in the main chat area on desktop and mobile. The separate Inbox launcher, popup, and internal inbox navigation have been removed. Mobile opens the same navigation from the header arrow and closes it after selection, including selecting the already-open conversation.

Incoming acceptance/decline, outgoing pending requests, block/report, request settings, recipient-name starts, notification jumps, private room summaries, earlier-message loading, and server-side participant checks keep their existing APIs. The room stays mounted with its draft. Conversation drafts survive resizing. Room/channel selection returns to the room view. A notification can open a usable main-area DM over a mobile reply panel. Read receipts pause while the mobile navigation covers the conversation and while the browser document is hidden; the existing visibility refresh reconciles on return.

No migration or new credentials are required. Existing list refresh coalescing, realtime subscriptions, 15-second foreground polling, and conversation history paging are retained.

## Reproduce isolated verification

Use synthetic accounts only. To avoid changing the shared fixture or colliding with other work, make a temporary copy alongside it:

```sh
python3 - <<'PY'
from pathlib import Path
p = Path('scripts/tests/chat-mobile-fixture.mjs')
Path('scripts/tests/.chat-dm-sidebar-fixture.mjs').write_text(p.read_text().replace('54404', '54424').replace('3204', '3224'))
PY
node scripts/tests/.chat-dm-sidebar-fixture.mjs
```

In a second terminal:

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54424 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon SUPABASE_SERVICE_ROLE_KEY=test-service-role npm run dev -- --port 3224
```

Then:

```sh
node scripts/tests/chat-dm-sidebar-browser.mjs
CHAT_TEST_URL=http://localhost:3224 node scripts/tests/chat-mobile-header-browser.mjs
CHAT_TEST_URL=http://localhost:3224 node scripts/tests/chat-dm-previews-browser.mjs
```

Restart the fixture before each workflow requiring a fresh incoming request:

```sh
CHAT_TEST_URL=http://localhost:3224 node scripts/tests/chat-header-cards-browser.mjs
```

The new sidebar test covers incoming request acceptance on desktop/mobile, new recipient requests and pending state, send/receive/unread, unread preservation behind navigation, direct notification opening over a reply panel, private summaries, channel switching and room drafts, resize drafts, 320/390/768/1440px layouts, and denied third-party access. Screenshots: `/tmp/chat-dm-sidebar-desktop.png` and `/tmp/chat-dm-sidebar-mobile.png`. Browser verification uses Chromium/Puppeteer; physical iOS/Safari and realtime WebSocket delivery are not exercised by the PGlite fixture.

Verified: `npx tsc --noEmit`, targeted ESLint for PublicChat/DirectInbox, `git diff --check`, and `npm run build` all pass. All four browser workflows listed above pass. Production-build output is at `/tmp/chat-dm-sidebar-build.log`; the dev server was stopped before building. The targeted API/unit selection currently has three baseline failures in untouched room-entitlement expectations: two in `chatActivityRoute.test.ts` and one in `chatInboxRoute.test.ts` expect LB access for mocks without boardroom entitlement. The other 28 tests pass. An untouched archive of base `9e22409fc964da835a48745caefdc6a2abed96a8` reproduces the identical 3 failures / 28 passes; comparison output is saved at `/tmp/chat-dm-baseline-tests.log`.
