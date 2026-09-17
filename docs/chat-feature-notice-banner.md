# Feature work update banner

FeatureNotifications now shows a small upper-right banner for newly observed unread status notifications, including development starting, review readiness, blocked work and publication. It uses the existing 15-second polling/visibility-refresh stream and its server-side notification preferences; no API, database or worker behavior changed.

The first successful inbox snapshot silently seeds the existing notification tracker. Subsequent snapshots deduplicate IDs with a timestamp watermark, including equal-timestamp events. Repeated polls never restart a banner timer. A new work update replaces the displayed banner and starts a new two-second lifetime. X dismisses immediately. Neither path marks notifications read or removes history; the existing persistent inbox remains available. Ordinary discussion replies retain their existing inbox/sound behavior.

The banner is a body-level portal so it remains visible when mobile navigation is closed. It is at most 320px wide with 16px viewport margins. The body allows clicks through to the page; only the 44px dismiss button accepts pointer events. It announces politely and never moves focus. Long titles truncate visually but remain in the persistent inbox. The existing priority-saved toast is unchanged.

Validation:

- `node scripts/tests/chat-feature-notice-banner-browser.mjs`: real Chromium → Next API → isolated PGlite fixture. Silent initial/remount history, status filtering, two-second timer, repeated events, replacement lifetime, manual dismissal, unchanged unread/history, uninterrupted typing/focus, closed mobile navigation and no overflow/page errors.
- Isolated fixture `scripts/tests/chat-feature-notice-banner-fixture.mjs` uses 54414; Next uses 3214 with synthetic keys. No shared fixture edits.
- `npx tsc --noEmit` and targeted ESLint passed.
- Production build passed after stopping the dev server; existing unrelated warnings remain.
- Mobile screenshot `/tmp/feature-notice-banner-mobile.png` visually inspected.

No migrations or live data mutations are required.
