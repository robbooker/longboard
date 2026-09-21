# See Likes on Mobile

Long-press a reaction chip for 500 ms to see the people who used that reaction. The scrollable dialog supports Close, Escape and an outside tap. Ordinary taps still add/remove the reaction. Desktop hover names remain available; right-click or Shift+F10 opens the full list. Focus returns to the chip when the dialog closes.

Pointer movement beyond 10 pixels, cancellation, leaving the chip, target changes and unmount cancel a pending hold. Scrolling remains native. The release click from a long press cannot toggle the reaction or immediately dismiss the dialog. No additional inactive message-footer height is introduced.

The existing batched reaction summary exposes only ten names. The new `details` action on `/api/chat/message-reactions` instead pages 50 people at a time, ordered by immutable reactor UUID with an exclusive cursor. Every page authenticates the requester, validates same-origin access, checks room entitlement and calls existing `check_chat_reaction_target` for exact message/DM participation, block and deletion checks. Queries include only active reactions for the exact target/emoji. Room likes use the existing guest reaction table; other room reactions and DM reactions use the choice table. Only reactor ID and display name are returned, never email/auth identifiers. No new production schema or permission grants.

The list is a paged read, not a transactional snapshot or live subscription. Concurrent reaction changes can make the chip count differ while the dialog is open; reopening refreshes the list. No capped preview is presented as a complete list.

## Validation

- 717 unit tests / 94 files, including 24 reaction route tests.
- TypeScript and focused ESLint pass.
- Actual React provider/component/CSS Chromium matrix at 320, 390 and 1100 pixels. Mobile cases use emulated touch input: tap toggle, long press without toggle, 55 names across pages, scrolling, outside/Escape dismissal, Shift+F10, focus restoration, movement/pointercancel/unmount cleanup, no horizontal overflow or runtime errors.
- Existing isolated PGlite reaction authorization suite: 31 assertions pass.
- Release service mocked validation suite: 71 tests pass.
- Production build passes. HTTP release probe is only a login smoke check; authenticated UI acceptance is covered by the local synthetic browser fixture, not production.

Commands: `npm test`, `npx tsc --noEmit`, `node scripts/tests/chat-mobile-reaction-details-browser.mjs`, `node scripts/tests/chat-message-reactions-database.mjs`, `node scripts/tests/chat-release-service-test.mjs`, `npm run build`.

Integrated September 21, 2026 onto published DM scrolling PR #328, commit `16b2d5e02889f04a9d0d2bcc8df5f22097ba176d`. Rebase completed without conflicts. All checks above were rerun after integration. The scrolling browser regression also passed for DM and room views at 1440 and 390 pixels: snapshot before read, newest unread, gap paging, cached reopen, user scroll cancellation, new-request acknowledgement, and explicit deep-link priority. This branch does not edit scrolling components or read-marker behavior. Register only the final tested GitHub head.

Additional regression command: `node scripts/tests/chat-unread-opening-browser.mjs`. Production build includes existing repository ESLint warnings, with no build errors. Local validation logs are `/tmp/mobile-reactions-integrated-{unit,tsc,lint,db,release,build,browser,scrolling}.log`.
