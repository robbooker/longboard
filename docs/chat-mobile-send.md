# MOBILE SEND

Ticket: 8b792f18-4a26-47ad-a297-e8223ed70a52

Compact chat views (1099px or narrower) now reveal optimistic sends immediately. A confirmed successful room, DM, or thread send dismisses its still-focused composer and keeps the bottom visible through the keyboard viewport transition. Desktop focus behavior is unchanged.

The shared helper cancels when the user types a newer draft, deliberately scrolls, changes DM scope, or hides/unmounts the conversation. Failed requests cancel the helper and retain existing retry/draft behavior. Room sends already disable their composer during the request; this change does not alter their existing failure restoration. Event listeners expire after 45 seconds for a hung request and one second after successful acknowledgment.

The compact shell and thread panel use VisualViewport height, with dvh fallback, so the composer remains inside the visible area as a keyboard opens/closes. Pinch zoom does not shrink the layout using zoomed viewport measurements.

Validation:
- TypeScript passes.
- Focused ESLint passes.
- 632 unit tests in 85 files pass.
- `node scripts/tests/chat-mobile-send-browser.mjs` passes in installed Chromium. The synthetic fixture exercises the production helper and simulates keyboard changes with viewport resizing: immediate optimistic visibility, success blur, bottom alignment, newer draft preservation, failed request focus, deliberate scroll, hidden conversation, changed scope, and desktop behavior.
- Room/DM/thread handler integration reviewed: helper is created during submission before React commits the empty composer; its animation frame runs after that commit. Confirmation checks the current composer and scope again. Every failure cancels the helper.

These are synthetic browser checks, not physical iPhone or Android keyboard verification. No database migration or new permissions are required.

## Integration with published Favorite

Integrated published main `fc9cda3a1d4ed2f17de0f11da55728786d520d69`. The only merge conflict was adjacent imports in PublicChat; both features are retained. Combined validation: 648 unit tests/86 files, TypeScript, focused ESLint, Favorite SQL, and mobile-send Chromium regression pass.

The actual-component Favorite browser suite initially timed out when it programmatically reopened the same DM immediately after returning to the room. Repeating with a 100ms room-transition settle passed the complete Favorite suite (persistent selection, account isolation, 320px layout, room/DM shortcuts, revoked target, clearing). No production navigation logic or tracked Favorite tests were changed. This synthetic scheduling caveat is distinct from mobile-send behavior; no sends occur in that failing step.
