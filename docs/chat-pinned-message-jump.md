# Pinned message navigation

Approved request `0d9514d5-4bd3-41e3-8573-c94f74ee5359`, revision 2. This migration-free change completes the existing room-pin navigation UI; pin storage, permissions, APIs, room/thread data, and read-marker rules are unchanged.

## Reproduced behavior and fix

On published base `c5352d3890090064a32af596f82c67ac04b2c9a4`, an old root pin already fetched anchored history and scrolled to its message, but gave no destination emphasis. A pinned reply opened its exact existing thread, then restored that thread's saved scroll and focused its composer; revisiting a long thread could leave the pinned original offscreen. The baseline production-browser probe reproduced both behaviors.

Root pins now reveal the destination inside their own feed and add a three-second theme-colored outline. Reply pins reveal and outline the exact original comment inside their existing reply panel instead of restoring an obsolete scroll position. The saved text drafts remain unchanged. Every accepted root request triggers the existing layout observer even if reconciliation returns an unchanged message array, so repeated activation works. No new history, timer-based polling, or read operation is introduced.

Scrolling is instant and emphasis is static, including when reduced motion is requested. The outline leaves the existing text/background colors unchanged. The destination temporarily becomes keyboard focusable; focus moves only if the original pin button still owns focus and no modal is open. Existing editable contents and message actions remain intact.

A later pointer, keyboard, wheel or touch-move intention anywhere in the document cancels the pending jump and its emphasis. Hidden documents, window blur, open dialogs, inactive/hidden Quad panes, and Skip Latest also cancel it. Listeners and observers are removed on cancellation, reset, or unmount. Reactivation never replays a stored reply jump. The click that first activates an inactive Quad pane still works. A successful root jump can close its own previous reply panel without that history transition clearing its new outline. Existing room/account/navigation response guards remain in place.

## Local verification

All testing uses synthetic identities and data on the isolated production-mode Next app at port 3368, with the current published SQL/API fixture at 54568. The preload redirects only the fixed ShortScout membership-export URL to that local fixture. There are no production writes, push deliveries, summaries, or authenticated live-user verification.

- Full unit suite: **950 tests, 116 files** pass, including five helper cases for pane-local positioning, focus restraint, expiry, repeat cancellation, and tabindex restoration.
- TypeScript and production build pass. Lint reports **0 errors and 10 existing warnings**.
- Existing current-SQL pin suite: **63 assertions** pass for permission/current-access checks, idempotency, limits, canonical previews, nested targets, read/event preservation, and deletion/cascade behavior. This is sequential PGlite, not a native concurrent-session test.
- Existing release-service regression: **71 tests** pass. The release plan has no migrations and retains the standard unauthenticated login probe.
- Existing actual pin-hook/coordinator browser probe passes room/account scope, A→B→A, delayed save/refresh, unpin ordering, permission revocation, hidden-pane and unmount behavior.
- Existing full production pin-management browser regression passes with zero runtime errors: shared controls/peer view, 81-row anchored counts, preserved drafts/read boundary, edits/deletions/replacements, strict ShortScout and room access, recordings/Gainers restrictions, mobile/Quad, delayed old-room response, current permission revocation and anonymous denial.
- New production-browser matrix passes with **zero runtime errors** in Chromium 152: historical root, nested/deep reply, repeated same pin, pin and ordinary thread-close transitions, last-message visibility, keyboard focus, three-second expiry, preserved drafts, held root responses superseded by wheel/composer/search/modal/another pin, three themes, reduced motion, and 320px root/reply touch layout. Quad checks include inactive-to-active pin activation, delayed root/thread responses after switching panes with no replay on return, external Skip Latest, and the real global profile dialog. Computed styles confirm outline-only emphasis preserves root metadata and background colors in all themes.

The repository entry points are `scripts/tests/chat-pinned-message-jump-fixture.mjs`, `chat-pinned-message-jump-preload.mjs`, and `chat-pinned-message-jump-browser.mjs`. Set `CHAT_EXPECT_BASELINE=1` for the original no-highlight/saved-scroll probe against the unchanged published app. The current matrix captures desktop themes, mobile root/reply, and Quad screenshots under `/tmp/chat-pinned-message-jump-*.png`.

Evidence logs: `/tmp/chat-pinned-message-jump-{baseline,build,unit,tsc,lint,db,release,hook,browser,pins-regression}.log`. Screenshots were visually inspected locally. Mobile evidence is Chromium viewport/touch emulation, not physical iOS/Safari or Android-device verification. The destination aligns to the pane top where available scroll range permits; a last message near the end remains visible within the pane.
