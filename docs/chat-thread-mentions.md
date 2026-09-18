# Mentions in replies

Ticket f7ef4fd8-d322-40b7-bd17-60162a56756c reuses MentionTextarea in the reply composer: the same authenticated member lookup, filtering and insertion syntax as main chat. Buddy appears only in LB. Reply drafts, attachment paste, Enter/Shift+Enter/IME guards and focus restoration stay connected.

The shared component accepts an external textarea ref, list styling and fallback keyboard handler. Unique list/option IDs support multiple composers. Escape dismisses suggestions without closing the thread. A deferred caret update checks the value is unchanged so fast typing cannot move the cursor backward. Reply suggestions remain in the panel's scroll flow. No API, access-policy or database changes.

Validation: all 458 unit tests pass, including mention API authentication, identity-only projection, result bounds and query validation. TypeScript, targeted ESLint and production build pass (build log `/tmp/thread-mentions-build.log`; initial quota failures resolved by removing obsolete generated caches). `chat-thread-mentions-fixture.mjs` on 54469 and local app 3269 support `chat-thread-mentions-browser.mjs`: actual local API/database at 1440/390, filtering, arrow/Enter and pointer selection, multiword names, accessible list linkage, Escape, IME, Shift+Enter, fast typing, persisted send text and nested draft restoration. Main Buddy regression and unauthenticated lookup denial pass. Prior thread-edit browser suite passes on these ports too.

Screenshots `/tmp/thread-mentions-1440.png` and `/tmp/thread-mentions-390.png` visually inspected. Logs `/tmp/thread-mentions-browser.log`, `/tmp/thread-mentions-edit-regression.log`, `/tmp/thread-mentions-unit.log`. Mobile is Chromium viewport emulation. The older synthetic fixture returns unrelated 503s for activity-read writes; notification delivery is outside this check. No real messages or production writes.

Release plan contains no migrations and a public login probe; authenticated acceptance is covered above.
