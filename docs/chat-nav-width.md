# Navigation width formatting

The existing navigation stays a vertical list. Each room label and DM recipient name stays on one line; content wider than the column scrolls horizontally inside navigation. Long lists still scroll vertically. The page grid, chat composers, reply panel, message wrapping and mobile navigation behavior are unchanged.

Fourteen CSS lines constrain navigation to its grid column, disable column wrapping/shrinking, protect labels and badges from wrapping, and keep DM names/previews left-aligned. DM previews remain a separate ellipsized line. Inline-size containment prevents a long preview URL from determining the card width; long recipient names can still determine it. No markup, API, data or permissions changes.

Validation uses `scripts/tests/chat-nav-width-fixture.mjs` on 54414 and Next on 3214 with synthetic test credentials. `scripts/tests/chat-nav-width-browser.mjs` verifies 1440/1100/1099/768/390/320px widths, long room labels/names/badges, local horizontal and vertical scroll, no document overflow, preview sizing/alignment, keyboard focus, mobile Back/Escape, real accepted DM selection, room/reply draft retention and DM draft retention during resize. Extra sidebar rows and long display text are injected into browser DOM for layout stress; the selected DM is the real synthetic SQL-backed conversation. A 720×450 viewport at deviceScaleFactor 2 adds short-viewport/high-DPI focus coverage, not a claim of 200% browser zoom testing.

Existing behavior: reselecting a DM clears its draft in DirectInbox; this CSS change preserves resize drafts without changing that selection behavior. At 1100px with replies open, the central Longboard title compresses into a vertical stack. A temporary browser stylesheet restores only the pre-change values of the added navigation rules to compare title geometry: both states measured 8.296875px wide by 259.171875px tall. No separate baseline build was used. This header limitation is outside navigation scope. An extra last-DM Tab-wrap check also escapes the mobile navigation in both restored baseline and updated CSS: DM cards use a React portal and do not bubble keyboard events through the DOM navigation handler. Regular control focus, navigation Back/Escape and DM selection remain verified; this pre-existing event-handler limitation is not changed.

Evidence:
- `/tmp/chat-nav-width-browser.log`
- `/tmp/chat-nav-width-desktop.png`
- `/tmp/chat-nav-width-baseline-header.png`
- `/tmp/chat-nav-width-mobile.png`
- TypeScript and targeted ESLint passed.
- Production build passed with existing unrelated warnings; log: `/tmp/chat-nav-width-build.log`.

No shared fixture edits or production mutations.
