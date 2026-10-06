# Auto-Scrolling

Approved request `2e999d4c-33b1-48ec-bbb5-332034b5e1a1`, revision 2. Implementation base: published `947e69b7b73937da2c9d0a0cc7ee23788d972fc4`.

## Behavior and cause

Room and DM gesture handlers previously disabled following on wheel/touch start even when the viewport did not move. Their shared bottom check accepted only a 2px gap. Bounded historical room/reply windows also remained fixed after the reader paged all the way to the current tail, and reply panels had no continuous follow behavior.

Visible latest room, DM and reply panes now follow arrivals while following is enabled. Actual upward manual movement pauses following, including a small movement inside the bottom band. Deliberately moving down within 48px resumes following. Clicking/focusing a control, touching without scrolling, or wheeling down at an already-current bottom leaves the current follow choice intact. A current short viewport needs no artificial scroll gesture. Visible inactive Quad panes follow independently of keyboard focus; hidden/background panes do not write scroll position.

The helper requires recent pane-local manual input and actual scroll movement. Held pointer/touch gestures stay active until release/cancel/blur; detached input expires after one second. Programmatic writes clear intent, and viewport/content geometry changes reject old intent. Touch drags starting on message buttons/links remain native scrolling. No preventDefault, scroll lock, animation, polling or timer was added.

Following is separate from read acknowledgement: room sequence reads still require the existing 2px bottom geometry and current room/activity authorization, active/visible and document safety gates. The 48px follow tolerance is not a read boundary. DM visible-row reads and exact notification observers remain unchanged. Initial unread reveal, explicit Latest snapshots and conservative send read holds retain their existing contracts.

At the bottom of an older page, an unread gap remains an unread gap. Room/reply windows return to the live tail only after deliberate downward return and canonical reconciliation reporting no newer page. They reuse the existing coordinator; no API/SQL/schema change. Latest also settles any automatic opening started by activating an initially inactive Quad pane, so its delayed cleanup cannot disable a successful Latest reveal. Opening a pin in an already-following thread pauses it before revealing its original comment.

## Verification

Completed against Chromium `152.0.7977.82`, production Next.js build, and the current published synthetic SQL/Auth fixture on ports `3380/54580`:

- Full unit suite: **1,036 tests / 121 files passed**, including seven direct geometry/input-lifetime boundary tests. TypeScript and production build passed. Lint: **0 errors, 10 existing warnings**. Release service: **71 passed**. Existing room-unread SQL regression passed.
- `scripts/tests/chat-auto-scroll-browser.mjs`: real room/DM/nested-reply rendering and SQL arrivals; no-op wheel/touch/pointer, real upward wheel, five repeated native wheel-to-arrival races, a native scrollbar held over one second, 48px downward return versus 49px, delayed layout/expired intent, preserved drafts/focus and visible message anchors. More than 80 roots and 100 nested replies verify old-page gaps stay bounded, canonical final pages become live without Latest, and future arrivals render. Same-thread pin, inactive/hidden Quad read safety, native touch drags beginning on content and a Reply button, portrait/landscape, and a genuinely non-overflowing latest SOCIAL window passed. Zero runtime errors.
- Existing `chat-skip-latest-browser.mjs --quad-advance`: visible unfocused room/DM panes, late media, hidden/background safety, mobile reveal, deep links, explicit Latest, held send/read/room/edit races and failed snapshots passed. Its intended manual-history setup now supplies wheel intent before changing scrollTop; failed-Latest assertions are unchanged. Failure diagnostics report pane geometry.
- Existing production `chat-start-unread-browser.mjs`: oldest unread windows, nested pagination, exact visible/shared read boundaries, held future snapshots, draft/send retry, conservative send read holds, canceled page/opening requests, repeated Latest, full-page deletion and strict SS authorization passed with zero runtime errors.
- Existing production `chat-pinned-message-jump-browser.mjs`: historical/root/reply/deep and repeated navigation, keyboard, drafts, ordinary thread close, held user-intent cancellation, all three themes, reduced motion, 320px touch layout, Quad deactivation/reactivation, external Latest and global dialogs passed with zero runtime errors.

Logs: `/tmp/chat-auto-scroll-{units,tsc,lint,build,release,database,browser,quad-regression,unread-regression,pin-regression}.log`. Screenshots inspected: `/tmp/chat-auto-scroll-quad.png`, `/tmp/chat-auto-scroll-mobile-390.png`, `/tmp/chat-auto-scroll-mobile-844.png`.

The reusable fixture/preload are `scripts/tests/chat-auto-scroll-fixture.mjs` and `scripts/tests/chat-auto-scroll-preload.mjs`. All accounts/messages are synthetic local data. No production messages or authenticated live-user behavior are claimed. Browser checks compare visible message ID and offset across bounded-history head eviction; absolute scrollTop naturally changes when old rows leave the page. Gainers correctly rejects member-authored rows, so the short-window acceptance uses normal SOCIAL. Puppeteer's default hidden scrollbars are disabled to exercise a real native thumb.

Physical touch inertia/keyboard behavior remains browser/device controlled; Chromium mobile emulation is not a physical iOS/Safari device test. No unshipped ShortScout authorization-recovery changes are included. This migration-free release uses the existing sole publisher and does not change release safeguards.
