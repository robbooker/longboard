# Compact DM reaction controls

Ticket: `763357b8-732a-4009-9ad1-0db151100f12`.

DM messages now place their accessible Add reaction icon beside the existing header actions. An empty reaction footer has zero height and no top margin; actual reaction chips retain their footer. Room and reply reaction layout remains unchanged. The compact component observes the whole message article, so a tall attachment/body still receives reaction updates when its header is outside the viewport. Native dialog keyboard handling, API permissions, and reaction toggles remain unchanged.

Verification used the isolated synthetic fixture on 54483 and app 3283, with no production messages. Chromium desktop 1440px and mobile 390px emulation covered light/dark themes and zero, one, and multiple reactions; Enter/Escape restored focus, 44px touch targets remained accessible, and real API add/remove succeeded. A 1200px synthetic tall body verified continued reaction reads when only the lower message area was visible. No page errors or horizontal overflow were observed. Physical Safari/device testing was not performed.

Height comparisons reconstructed the previous footer markup/styles in a temporary DOM clone beside the same message; this was not a production A/B test. Outgoing samples shrank 151.7→113.7px (38px saved), incoming desktop 139.7→113.7px and mobile 161.4→135.4px (26px saved). Both themes matched. Zero-reaction footer height measured 0px. These are sample-message dimensions, not a guarantee for every wrapped message.

Evidence: `/tmp/dm-spacing-browser.log` and `/tmp/dm-spacing-{desktop,mobile}-{dark,light}-{zero,heart,laugh}.png`. Targeted ESLint and TypeScript passed. Parent ran the existing 549-test suite successfully. Final production build passed on retry (exit 0). Build log: `/tmp/dm-spacing-build.log`; first attempt failed filesystem quota during webpack cache writing, requiring removal of obsolete published build artifacts before retry.
