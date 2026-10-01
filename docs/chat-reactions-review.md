# Reactions Review

Request: `be9f9a3e-8aa8-4230-b939-12b808177d8c`

The existing reaction-details popup shows each person's full name on the left and the matching reaction icon right-aligned in a fixed 32px column. Long names wrap without pushing the icon out of alignment. The row reuses the icon supplied by the pressed reaction, including the LB palm, ShortScout lemon, DM thumbs-up, heart, laugh, and custom Rob image. Repeated icons are decorative for assistive technology; the popup heading identifies the reaction.

The popup stays filtered to its existing message, conversation/room, and reaction. Its authorization, pagination, loading/error/empty states, focus restoration, and request count remain unchanged. No database, API, dependencies, or reaction-target rendering changes are needed.

Native touch testing also reproduced a release click hitting Close when that button appeared beneath a held finger. The popup now ignores pointer clicks that began before it opened. Fresh pointer gestures and keyboard/accessibility clicks continue to work, including explicit Close and backdrop dismissal. This guard is local to the popup.

## Verification

- `npm test -- lib/__tests__/chatMessageReactionsRoute.test.ts lib/__tests__/chatReactionNamesRoute.test.ts lib/__tests__/boardroomChatReactions.test.ts`: 36 tests covering reaction scope, access/privacy checks, pagination, input validation, and existing behavior.
- `node scripts/tests/chat-reactions-review-browser.mjs`: actual provider, popup, CSS, and Next Image against synthetic local responses, with 48 target/reaction combinations at 320px, 390px, and 1100px. Verifies all icons, single/50/55 results, long and unbroken names, escaped markup, right-edge alignment/overflow, exact scoped requests, one request per page, native tap/click pagination and retry after initial/page errors, empty state, native long-press, Shift+F10, focus restoration, ordinary toggles, and hold cancellation. The exact overlapping native release is a permanent regression; later tap, keyboard, and backdrop dismissal must still work. Screenshots are written to `/tmp/reactions-review-*.png`.
- `npx tsc --noEmit`, `npm run lint`, and `npm run build` verify the application. Existing unrelated lint warnings remain.

The browser fixture uses loopback port 3352 by default (`CHAT_TEST_PORT` overrides it) and never connects to production services. The migration-free manifest must be registered and published through the dedicated release service only after final current-main integration checks.

October 1 integrated validation passed on published main `96567f1af914b814c678d28fdb942437644570aa`: 830 tests in 104 files, TypeScript, lint (10 existing unrelated warnings), production build, and the full browser matrix above. The merge had no conflicts. Published Posting Links, Quad behavior, and deleted-message reaction suppression remain unchanged.
