# Return to message composer

Ticket: `cfccc643-ab3d-4440-94bf-cec8155306d4` (RETURN TO MSG).

After a confirmed room, direct-message, or reply send, the shared send lifecycle focuses the originating composer and places the caret at the end after React commits the updated draft. Focus uses `preventScroll`. On mobile, the previous success-time keyboard dismissal is removed. The room composer remains read-only during a pending send; the send guard and disabled button still reject duplicates.

The originating composer or its submit button must own focus when sending begins. Any subsequent input, keydown, pointer action, focus on another element, or deliberate history scroll cancels the pending restoration. Hidden/disconnected views, a hidden browser document, stale conversation scopes, and failures cannot restore focus. This also preserves a newer draft and its selected caret, and prevents a background retry from taking focus from another control. Existing mobile bottom-reveal behavior remains; desktop scroll behavior is unchanged.

Verification:

- `npx tsc --noEmit`
- `npm test` — 811 tests, 102 files.
- `npm run lint` — no errors; ten existing unrelated warnings.
- `node scripts/tests/chat-release-service-test.mjs` — 71 tests.
- Production `npm run build` with synthetic fixture configuration.
- `node scripts/tests/chat-mobile-send-browser.mjs` — production helper in Chromium at desktop/mobile widths: room/DM/thread lifecycle, submit focus/caret, committed value, failure, changed scope, hidden pane, newer draft/caret, later pointer/focus intent, background retry, scroll and viewport behavior.
- `node scripts/tests/chat-return-message-browser.mjs` against the production build with `CHAT_TEST_URL=http://localhost:3346`. Uses `CHAT_FIXTURE_PORT=54546 CHAT_APP_PORT=3346 node scripts/tests/chat-recordings-fixture.mjs` and synthetic Supabase keys. Checks actual room and DM Enter/button sends at desktop/mobile widths, duplicate Enter while pending, confirmation focus/caret, deliberate settings focus, and failed room draft/focus.

Mobile testing uses responsive Chromium. Physical iOS/Android keyboard presentation remains browser-controlled and has not been device-tested. No database migration, permission change, or release-service modification is required.
