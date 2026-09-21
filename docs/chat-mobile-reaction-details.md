# See Likes on Mobile

Long-press a reaction chip for 500 ms to see the people who used that reaction. The scrollable dialog supports Close, Escape and an outside tap. Ordinary taps still add/remove the reaction. Desktop hover names remain available; right-click or Shift+F10 opens the full list. Focus returns to the chip when the dialog closes.

Pointer movement beyond 10 pixels, cancellation, leaving the chip, target changes and unmount cancel a pending hold. Scrolling remains native. The release click from a long press cannot toggle the reaction or immediately dismiss the dialog. No additional inactive message-footer height is introduced.

The existing batched reaction summary exposes only ten names. The new `details` action on `/api/chat/message-reactions` instead pages 50 people at a time, ordered by immutable reactor UUID with an exclusive cursor. Every page authenticates the requester, validates same-origin access, checks room entitlement and calls existing `check_chat_reaction_target` for exact message/DM participation, block and deletion checks. Queries include only active reactions for the exact target/emoji. Room likes use the existing guest reaction table; other room reactions and DM reactions use the choice table. Only reactor ID and display name are returned, never email/auth identifiers. No new production schema or permission grants.

The list is a paged read, not a transactional snapshot or live subscription. Concurrent reaction changes can make the chip count differ while the dialog is open; reopening refreshes the list. No capped preview is presented as a complete list.

## Validation

- 695 unit tests / 92 files, including 24 reaction route tests.
- TypeScript and focused ESLint pass.
- Actual React provider/component/CSS Chromium matrix at 320, 390 and 1100 pixels. Mobile cases use emulated touch input: tap toggle, long press without toggle, 55 names across pages, scrolling, outside/Escape dismissal, Shift+F10, focus restoration, movement/pointercancel/unmount cleanup, no horizontal overflow or runtime errors.
- Existing isolated PGlite reaction authorization suite: 31 assertions pass.
- Release service mocked validation suite: 71 tests pass.
- Production build passes. HTTP release probe is only a login smoke check; authenticated UI acceptance is covered by the local synthetic browser fixture, not production.

Commands: `npm test`, `npx tsc --noEmit`, `node scripts/tests/chat-mobile-reaction-details-browser.mjs`, `node scripts/tests/chat-message-reactions-database.mjs`, `node scripts/tests/chat-release-service-test.mjs`, `npm run build`.

Integration order: rebase onto the published DM scrolling head before final registration, rerun checks and register only that exact tested head. This branch does not edit scrolling components or read-marker behavior.
