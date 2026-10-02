# Social sidebar membership label

Ticket: `d7d4da1e-28b2-415f-83a9-431740277c04`, development-approved revision 2.
Initial published base: `bfbfed364757c2f176893eaa74dfccdccb3c9577`.

The existing Social sidebar link now shows a smaller `(LB + SS)` immediately beside its name. Both the authorized link and its locked alternative use the same presentation. The label group inherits the link's theme color and uses a four-pixel gap; the unread badge remains a separate right-aligned item. Desktop text is 14px with a 10.5px qualifier; compact navigation uses 16px and 12px respectively.

Only `PublicChat.tsx` and its scoped stylesheet change application behavior. Canonical room labels, conversation headers, message/history/push names, URLs, click handlers, unread markers, personal pins, and permissions remain unchanged. Quad has no existing sidebar, so this change adds no Quad navigation surface. No database, API, scheduler, or release-service change is included. The exact release plan has an empty migration list.

## Local validation

The production Next application ran on port 3366 against the existing synthetic PGlite/auth fixture on 54566. The local membership preload redirects only the existing source endpoint to synthetic test data. No production service or credentials were used.

- Production build: passed.
- TypeScript after the build: passed.
- Lint: passed, zero errors and ten existing warnings.
- Release safeguard regression suite: all 71 passed.
- Browser: Chromium `Chrome/152.0.7977.82`, desktop 1440px and emulated touch/mobile 320px, dark/light/Blade Runner themes.
- Measured qualifier gap: 4px. No horizontal document overflow; the unread badge remains separated on the right. Resolved foreground/background contrast for the nonselected link is 6.61:1 dark, 4.76:1 light, and 8.25:1 Blade Runner.
- Real mobile taps and desktop clicks retain the original destinations, canonical Social header, draft, and existing unread clearing. The locked Social branch is exercised by substituting only a history 403 in a real authorized update batch; it retains its original login destination. This is a rendering test, not a new authorization proof.

The browser script is `scripts/tests/chat-social-label-browser.mjs`. Viewport screenshots are `/tmp/chat-social-label-{1440,320}-{dark,light,blade-runner}.png` and `/tmp/chat-social-label-320-locked.png`; logs use `/tmp/chat-social-label-{build,tsc,lint,release,browser}.log`.

Initial browser retries corrected only test assumptions: the canonical header is mixed-case `Social`, the existing LB destination is `/chat?room=main`, and revoking the only SS membership redirects to login, so the locked-state rendering case uses a controlled history denial plus the existing room refresh. Mobile captures wait for the existing navigation animation to finish. No runtime change was made in response to these harness corrections.

This verifies Chromium with emulated mobile dimensions, not Safari/Firefox or physical devices. No new unit tests duplicate the two presentation changes; no new database authorization suite is needed because authorization is unchanged. Parent integration with the actual published Notification List and Phone heads, followed by relevant validation, is still required before release registration.
