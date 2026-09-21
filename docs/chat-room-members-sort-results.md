# Member List Sort v2 browser verification

Passed September 21, 2026: `node scripts/tests/chat-room-members-sort-browser.mjs`.

The actual RoomMemberList component and CSS are bundled into a dynamic localhost fixture. A mocked POST directory endpoint globally orders 135 synthetic members, including 65 online members, then returns pages of 50. Chromium at 390×844 verifies:

- All three pages contain the expected full-directory order: 50 online, then 15 online plus 35 offline, then 35 offline. No gaps or duplicate members.
- Next/Previous work; the final page disables Next. Search resets to page one and sends a null cursor.
- Replacing the presence Set with identical contents in reverse insertion order neither resets the page nor requests data again.
- A real presence membership change resets to page one and aborts an in-flight second-page request. Even when the mock deliberately resolves that aborted request later, its rows cannot overwrite the current results.
- Returning from presence snapshot A to B and back to A stays on page one instead of resurrecting the previous page-two cursor.
- Presence unavailable resets to alphabetical page one, sends an empty online snapshot, and labels every displayed member “Status unavailable.”
- The current member cannot open a DM with themselves. Selecting another member closes the dialog and invokes the DM callback with the correct member; reopening and Escape restore trigger focus.
- No browser page errors.

Visually inspected `/tmp/chat-room-members-sort.png`: the mobile dialog fits the viewport, its member rows scroll independently, and both pagination controls remain visible. This synthetic fixture supplies minimal theme variables rather than the full application shell.

Limits: server responses are mocked here; independent PGlite tests verify actual SQL sorting and cursor behavior. This does not test production membership authorization, live Supabase presence transport, or physical Safari/iPhone. The agent-browser skill was read, but its CLI was unavailable, so existing Puppeteer/Chromium tooling was used. No production requests or changes were made.

## Database and API checks

The actual migration ran in isolated PGlite: 128 eligible members including 75 online traverse three pages without missing or overlapping rows. Checks include alphabetical ties, deleted cursor members, changed presence snapshots, search, duplicate/foreign presence hints, room entitlements, expired memberships, blocks, malformed cursor tuples and service-only grants. The existing directory/count SQL suite also passes. The new function is additive; the existing GET endpoint and four-argument RPC remain compatible during rollout. Presence remains advisory ordering data, never authorization. Requests over 5,000 online IDs fail explicitly rather than silently excluding online members.
