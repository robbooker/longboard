# Posting Links

Request: `b0511dd2-5ac8-4fc7-8a92-eca4997a038c`

Room, reply, private-message, private-request, and message-edit composers show a compact list of links in the current draft. It updates from the existing text value while typing, pasting, restoring drafts, or adding a GIF URL. Empty drafts and text without a usable HTTP(S) URL show no preview. Repeated destinations appear once, and long lists scroll within a bounded height.

The preview reuses the posted-message tokenizer, validates destinations with `URL`, and renders escaped text in native anchors. Links open in a new tab with `noopener noreferrer` and a no-referrer policy. It does not fetch destinations, load images, prefetch links, or create rich previews. The existing text input, draft ownership, composition events, send/save handlers, message IDs, permissions, and read/scroll logic remain in control. There are no database changes or dependencies.

## Validation

- `npm test`: full Vitest suite, including malformed URLs, hostile protocols, punctuation, duplicates, multiline text, and TradingView/GIF plain-link handling.
- `npx tsc --noEmit` and `npm run lint`: type checking and repository lint; existing unrelated lint warnings remain.
- `npm run build`: production build with synthetic local service configuration.
- `node scripts/tests/chat-posting-links-browser.mjs`: actual composer components and CSS with synthetic API responses. Covers 1440px desktop and 390px touch layouts, all seven writable room kinds, replies, DMs, new DM requests, both edit dialogs, and constrained Quad room/DM layouts. Verifies live typing, input identity/focus/caret, genuine rich clipboard paste, no remote draft requests or injected HTML, long URL wrapping, mouse/touch/keyboard new-tab navigation, null opener, intact draft, Shift+Enter, IME Enter, draft isolation on room switches, and one send/save followed by preview reset. Screenshots are written to `/tmp/posting-links-*.png`.

The fixture uses Chromium and the repository's Puppeteer setup. It requires a local loopback listener (default port 3350, override with `POSTING_LINKS_PORT`) and does not access production credentials or messages.

Publication must register and approve the final exact commit and use the dedicated release service. This ticket is migration-free.
