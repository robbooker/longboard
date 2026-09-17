# Focused mobile replies

Approved feature request: `3259d476-f14d-479c-ab0d-b9b992512179` (revision 4).

On widths below 1100px, Reply opens a focused conversation with the original comment, indented direct replies and then the editable composer. Each reply can open its own conversation, allowing arbitrary nesting without fetching an unbounded tree. The header Back button and browser Back/Forward (including native browser back gestures) navigate the conversation stack. Close and Escape return directly to the room. Native gesture behavior depends on the browser; no custom swipe gesture is installed.

The room remains mounted, retains its composer, and stops auto-scrolling while the mobile panel is open. The hidden room is inert. Each conversation retains its own draft and scroll position in memory for the lifetime of this chat page. Reloading or leaving the page clears reply drafts. Desktop keeps the side panel and room usable together. Mobile entry/return animations respect reduced-motion settings; safe-area padding and 16px inputs support small screens.

Existing room-authorized thread GET and parent-validating message POST remain authoritative. Each conversation shows its latest 100 direct replies and the existing truncation notice. Deeper replies are reached through their parent rather than flattened into the root list. No schema migration, new production credentials or auth changes are required.

## Verification

- `npm test` (298 existing API/unit tests, including parent linkage, missing/cross-room parent and room membership checks).
- `npx tsc --noEmit` and targeted ESLint; production build.
- Reproducible Chromium workflow against isolated PGlite dummy accounts, never production messages:

```sh
node scripts/tests/chat-mobile-fixture.mjs
```

In another terminal:

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54404 NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon SUPABASE_SERVICE_ROLE_KEY=test-service-role npm run dev -- --port 3204
```

Then:

```sh
node scripts/tests/chat-mobile-browser.mjs
```

The browser script defaults to `/usr/bin/chromium`; override with `CHROMIUM_PATH`. Restart the fixture between test runs to reset dummy messages. Tests cover linked child/grandchild submission, failure-retained draft, Back/Forward/Close/Escape, independent conversation and room drafts, room scroll restoration, keyboard focus trap, reduced motion, mobile widths 320/375/390/768 and landscape 844, desktop widths 1100/1280/1920, overflow and page errors. `/tmp/mobile-reply-focused.png` captures the mobile result. This is responsive Chromium verification, not a physical iOS/Safari device test.

## Reply order correction
Rob requested the Slack-style reading order after reviewing the release: original comment → replies → reply composer, on both desktop and mobile. The composer now follows the conversation in the same scrollable panel; reply linking, drafts and navigation are unchanged.

## Mobile room navigation

Below 1100px, the room navigation is hidden behind an accessible left-arrow button in the chat header. The arrow opens the existing rooms, Features and Search navigation as a full-screen view. Back to chat, Escape, current-room selection and Search close it; switching rooms uses the existing membership-gated links and per-room draft storage. The room remains mounted and inert behind the navigation. Focus is contained while open and returns to the arrow on close. Desktop retains the visible sidebar; resizing to desktop dismisses the mobile navigation state. Reduced-motion preferences disable its entry animation.

The isolated browser workflow also covers opening/closing navigation, keyboard return focus, LB/SOCIAL switching with room draft preservation, 320/375/768px overflow, and mobile/desktop resizing.
