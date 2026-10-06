# Quad pinned-message disclosure

Request `48a8e513-bf0a-49f8-b692-6c534419dd2f`, approved revision 2.

Quad room panes now start with a compact “Pinned messages N/10” disclosure. Show/Hide text, a rotating chevron, and the expanded state identify the action. Expanding reveals the existing pin previews and administration controls. Normal chat keeps its original always-visible shelf.

The choice belongs to the mounted account, member, and room. It survives temporary pane hiding, maximizing another pane, mobile tab switches, and an empty pin list. A new room/account/member or a page reload starts collapsed. Pin updates preserve the choice and update the count; an empty list has no shelf unless there is an error. Errors remain visible when collapsed. No stored preference, request, polling, read mutation, or navigation is added by the disclosure.

The native button supports keyboard and touch, has `aria-expanded` and a unique `aria-controls` target, and retains a visible focus indicator. Collapsed content is inert and hidden from assistive technology. The reveal is 160 ms and uses no animation when reduced motion is requested. The small-screen toggle has a 44 px minimum height. Existing pin navigation, server ordering, unpin permissions, error handling, and read-marker logic remain unchanged.

## Validation

The local production application runs against the synthetic current-schema fixture on ports 3375/54575. Browser checks use installed Chromium with real page rendering, application routes, synthetic authentication, and database state. This does not establish physical-device animation or authenticated production-user behavior.

Final checks on October 6, 2026:

- Full unit suite: 1,009 tests in 120 files pass. TypeScript and production build pass. Lint has zero errors and the same 10 existing warnings.
- Existing room-message-pins database regression: 63 assertions pass, covering access/admin restrictions, stable order and idempotency, canonical previews/deletion, read/event preservation, and service-only permissions. This is sequential PGlite coverage, not a concurrent native PostgreSQL test.
- Release-service regression: all 71 tests pass.
- Production disclosure matrix in Chromium 152 passes: compact default; keyboard/Tab and touch access; hidden/inert descendants; independent pane choices; same/other-pane maximize/restore; mobile tab roundtrip; room reset; live count and server order; same-room empty/first-pin retention; visible collapsed error and successful unpin retry; historical/root/nested pin navigation; draft and historical scroll preservation; unchanged persisted room read boundary; all three themes; reduced motion; 320 px portrait and 844 px landscape; unchanged normal shelf; zero browser runtime errors.
- The existing complete production pinned-message-jump matrix also passes. It covers normal desktop/mobile root/reply/deep targets, repeated activation, keyboard, draft/highlight lifetime, held requests superseded by navigation/scroll/composer/dialog, and Quad activation/deactivation, Latest, and modal cancellation. Its only adaptation opens the new Quad disclosure before using its pin buttons.

Evidence logs are `/tmp/chat-quad-pin-collapse-{unit,tsc,lint,build,database,release,browser,pin-regression}.log`. Screenshots are `/tmp/chat-quad-pin-collapse-{dark,light,blade-runner}-{closed,open}.png` and `/tmp/chat-quad-pin-collapse-mobile-{320,844}.png`. Light-theme collapsed/expanded and 320 px screenshots were inspected; the count, cues, controls, and message/composer layout remain readable and within the viewport. React best-practices review was applied to the two TSX changes: local state, stable scope reset, hooks before conditional returns, unique control IDs, native button semantics, and no new fetching or global listeners.

## Reproduction

Start `scripts/tests/chat-quad-pin-collapse-fixture.mjs` with the existing `tsx` import. Build/start the application using the fixture's synthetic Supabase settings, port 3375, and `scripts/tests/chat-quad-pin-collapse-preload.mjs` as the Node import. That preload redirects only the fixed membership-export URL to the synthetic endpoint. It does not use production credentials.

Run `scripts/tests/chat-quad-pin-collapse-browser.mjs`. The script rejects non-local application or fixture origins. The existing pinned-message-jump browser suite accepts `CHAT_TEST_URL=http://localhost:3375` and `CHAT_FIXTURE_URL=http://127.0.0.1:54575`; its Quad checks open the disclosure before interacting with pins.

## Release

The release plan is `.release/48a8e513-bf0a-49f8-b692-6c534419dd2f.json`. No migration, API, authorization, schema, scheduling, or release-service changes are included. The login-page probe is an HTTP smoke check; it does not replace the authenticated browser acceptance checks. Publication remains the coordinator's exact-version process through the dedicated release service.
