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
