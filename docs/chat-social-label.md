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

This verifies Chromium with emulated mobile dimensions, not Safari/Firefox or physical devices. No new unit tests duplicate the two presentation changes; no new database authorization suite is needed because authorization is unchanged. Published Notification List and Phone integrations are verified below. The coordinator retains hosted checks and exact-version release registration.

## Published Notification List integration

Parent rebased the Social checkpoint onto published Notification List `298bb5eaa68e9f4e6cded7cac73884438ac5cb9f`, producing `bc595b1f2ca84832d5046613aa889f08eb7f0002`. No Social runtime edits were needed.

On that combined build, all 937 units (114 files), production build, post-build TypeScript, lint (zero errors / ten existing warnings), and all 71 release checks pass. The fixture was updated by selecting the existing `chat-notification-list-fixture.mjs`, which loads the actual published retained-notification migration; ports remained 3366/54566.

The full existing Notification List production browser regression passes: seven alert forms retain read entries; failed-read retry and held mark-all preserve later events; unread totals/cursors and pinned-DM counts reach the exact expected values; read DM/reaction/recording/reply entries revisit without redundant acknowledgement; deleted targets disappear; Quad acknowledgements retain read rows for Single; feature notifications still retain and revisit their tickets. The Social browser matrix also passes on the same build, including all desktop/mobile themes, navigation, draft/unread behavior, and the documented controlled history-denial rendering check. No browser runtime errors were observed.

Combined logs use `/tmp/chat-social-label-integrated-{build,unit,tsc,lint,release,browser,notifications-browser}.log`. The browser regenerated the existing viewport screenshots. The subsequent published Phone integration is recorded below.


## Final published Phone integration

Parent rebased onto actual published Phone `e0dc431598e266b24860810ea876f9e4fd6ec492`, producing `02e1fb77ba15a9b23e28ab520dfc6751bb3c4dc2`. The two-file Social runtime change is unchanged. The new local-only `chat-social-label-fixture.mjs` wraps the existing Notification List fixture and loads the published Phone migration too; it introduces no runtime service or schema change.

Final combined validation passes:

- 941 unit tests across 114 files; production build; post-build TypeScript; lint with zero errors and the same ten existing warnings; all 71 release safeguards.
- All 119 published Phone database assertions against the current migration chain, including privacy, live target/read checks, unchanged queues/read functions, and retained read entries never replaying pushes.
- All 63 published Phone registered-worker assertions: real formatter output reaches the worker's native title/body invocation; privacy/Unicode/legacy/malformed inputs, safe click destinations and draft preservation remain intact. The existing harness ran unchanged except for a temporary port substitution to assigned port 3366, before starting Next; no harness source modification was retained.
- The full retained-notification production browser matrix again passes on the final build with the current fixture: exact unread/pinned-DM counts and cursors, retained/read navigation, deletion, Quad, mobile bounds, and unchanged feature notifications.
- The actual Social production browser matrix again passes desktop and 320px dark/light/Blade Runner navigation and spacing, normal unread clearing, draft preservation, and the accurately bounded controlled history-403 locked rendering case. No browser page errors were observed.

Final logs: `/tmp/chat-social-label-final-{build,unit,tsc,lint,release,phone-database,phone-worker,notifications-browser,browser}.log`. Screenshots retain the paths above. The service-worker test uses synthetic events and stubs native display/client APIs; no real push was sent and no physical-device presentation claim is made. The database checks use sequential local PGlite. The release plan remains migration-free. All owned test listeners are stopped after verification; only the coordinator and dedicated release service perform external release actions.
