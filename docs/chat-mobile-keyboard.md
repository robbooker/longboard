# Mobile chat keyboard dismissal

Approved request `499dcd1c-d763-451d-8104-d28736fa9519`, revision 2. Based on published main `29454c01c2bb0ce20612aef7d936eb2b0475d262` including DM copy controls.

## Behavior and boundaries

A short touch tap on noninteractive chat content outside the composer form dismisses its keyboard by blurring the focused send textarea. A deliberate downward single-finger swipe does the same once it moves at least 40 CSS pixels and is predominantly vertical. This applies to room, nested-reply, private-message and message-request composers, including their existing Quad panes. It does not automatically dismiss after sending: the user chooses to dismiss, and a later send acknowledgement must respect that choice.

Each `PublicChat` main element owns one passive touch watcher. The three send textareas are explicitly marked; an edit, search, settings or dialog input is not eligible. The active textarea must still belong to that same pane at the point of dismissal. Composer forms/toolbars, links, buttons, labels, text inputs, editable content, list choices and media controls are excluded. Open dialogs, selected text, multitouch, cancelled gestures and long stationary presses suppress dismissal. Upward/sideways history gestures and scrolling within a textarea are not dismissal gestures. Ordinary browser focus changes on interactive controls remain native.

There is no `preventDefault`, `stopPropagation`, synthetic click, scroll assignment, animation, scroll lock, `touch-action` or overscroll change. The watcher clears its gesture and removes its listeners on unmount. Existing send focus management, draft/outbox state, viewport sizing, message/read APIs, authentication and scrolling code are unchanged. No timers, polling, schema changes or migrations are introduced by the runtime change.

Native keyboard visibility and animation are controlled by the OS/browser. [`HTMLElement.blur()` removes keyboard focus](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/blur); the application does not customize the keyboard animation. Existing pull-to-refresh/overscroll policy is preserved, not newly enabled. Physical iOS/Safari and Android keyboard animation, momentum and pull-to-refresh behavior have not been verified on a device.

## Local evidence

All accounts and data are synthetic. Production-mode Next runs on 3372 with the existing current-schema PGlite/Auth fixture on 54572. The fixture preload redirects only the fixed membership-export URL to its local source. Public fixture URL/anon key must be supplied at **build time as well as server start**. No production credentials, messages, schema writes or summaries are used.

- **968 unit tests / 118 files pass**, including nine gesture-intent cases. TypeScript and the production build pass. Lint has **0 errors and the existing 10 warnings**.
- **71 release-service tests pass** and the migration-free plan validates against this request. Its unauthenticated login probe is only a live smoke check; it cannot verify a keyboard gesture.
- The actual observer bundle in Chromium verifies tap/downward recognition; upward/sideways/small movement; long press, cancelled touch and multitouch; input/form/control/selection/dialog exclusions; other-pane ownership; listener cleanup; and unchanged touch defaults.
- The production Chromium 152 matrix uses native CDP touch input. It verifies portrait/landscape room dismissal, draft preservation, actual native history scrolling, upward/sideways/input-scroll preservation, and reachable composer additions. Real touch Send buttons invoke the existing room, nested-reply and inbox APIs. The test holds successful responses until after dismissal, then verifies no refocus, stable visible message position and unchanged navigation. SQL queries confirm one persisted message for each send.
- Private conversations use their real portal and generated Quad composer IDs. The matrix covers standalone mobile DM and wide/mobile Quad room, reply and DM panes. It distinguishes native focus changes when choosing another pane from a watcher incorrectly calling another pane's `blur` method. No browser runtime errors occur.
- The existing `chat-mobile-send-browser.mjs` regression passes: send acknowledgement, caret/focus, viewport following, failed/new drafts, user scroll, hidden/changed conversations, desktop behavior and background retries.

The no-jump assertion follows the same visible message's viewport position, rather than raw `scrollTop`: reconciliation can trim rows or change pending-row height while preserving the user's visible anchor. The production test exercises that distinction without modifying the existing follow logic.

Screenshots: `/tmp/chat-mobile-keyboard-portrait.png`, `-landscape.png`, `-quad.png`, and `-quad-mobile.png`. Browser emulation verifies focus and touch event behavior; it does not display a physical software keyboard. Evidence logs: `/tmp/chat-mobile-keyboard-{focused,unit,build,tsc,lint,release,observer,browser,send-regression}.log`. Reproduction scripts are `scripts/tests/chat-mobile-keyboard-{fixture,preload,observer-browser,browser}.mjs`. The task's owned servers are stopped after verification. The coordinator retains publication through the dedicated release service.
