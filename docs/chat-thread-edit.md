# Editing messages inside reply threads

Ticket eefc5d00-427b-412c-9fde-e5304466c25c adds the existing main-chat edit dialog to an author's original message and reply cards in the reply panel. Saving updates the panel and main feed immediately, including the edited timestamp. Older in-flight thread reads cannot overwrite a saved result. An unsent reply draft remains intact. Escape dismisses the editor without closing the thread; native dialog keyboard handling is preserved. Dialog IDs are unique when a message appears in both the feed and the panel.

The reply panel uses an edit-only version of MessageActions. Ownership, announcement read-only state and paused-room restrictions are preserved. Existing server authorization, optimistic concurrency, room access and audit behavior are reused without schema/API changes. DM editing and edited labels already supported the requested behavior and remain unchanged.

TypeScript, targeted ESLint and production build passed; build log `/tmp/thread-edit-build.log` includes existing unrelated lint warnings.

Validation uses synthetic data only:

- `node scripts/tests/chat-thread-edit-fixture.mjs` on port 54467, app on 3267; `node scripts/tests/chat-thread-edit-browser.mjs` checks desktop 1440 and mobile 390, original/reply saves, Escape, draft preservation, immediate labels, persisted rows, author-only UI/API, stale and cross-room rejection, all five room edit endpoints and paused-room rejection.
- Existing room/DM API tests: 32 passing tests in chatMessageActions and chatDmMessageActionsRoute.
- Existing DM database suite: 34 assertions for ownership, conversation scope, stale/retry handling, blocks, deleted messages, previews and grants.
- Existing DM browser suite on these ports passed desktop/mobile editing, recipient updates, history, Escape/Enter/Shift+Enter, persisted state, preview changes and system-message restrictions.

Screenshots: `/tmp/thread-edit-1440.png` and `/tmp/thread-edit-390.png`. Logs: `/tmp/thread-edit-browser.log`, `/tmp/thread-edit-dm-browser.log`, `/tmp/thread-edit-unit.log`, `/tmp/thread-edit-dm-db.log`. Mobile is Chromium viewport emulation. The older synthetic fixture returns unrelated 503s for activity-read writes; these tests do not validate notifications. No real messages or production writes.

Release plan contains no migrations and a public login smoke probe; authenticated acceptance is covered by the tests above.
