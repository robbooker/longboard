# DM cursor after send

A DM send creates a one-use focus intent for the current textarea. After success or failure, React first re-enables the input, then restores its focus. Failed sends preserve the draft and retry identity. Other busy operations and inbox updates do not create focus intents.

Conversation selection, room return, a hidden conversation, closing, or moving pointer/focus outside the composer cancels the intent. Open modal dialogs suppress focus restoration. The existing initial composer autofocus uses matching visibility/modal guards so it cannot undo that cancellation when a send finishes. Temporary document listeners are removed when the send settles or the component unmounts.

Verification passed:

- Dedicated Chromium browser suite at 1440 and 390px: Enter and real pointer Send clicks; failure retains draft/focus; retry succeeds; held sends followed by outside focus, modal, actual second-conversation selection, or room return do not steal focus. Unrelated inbox refresh preserves outside focus. No browser page errors.
- TypeScript, targeted DirectInbox ESLint, and `git diff --check`.
- Production build; existing unrelated lint warnings remain.

Run `node scripts/tests/chat-dm-send-focus-fixture.mjs` on 54461, start Next on 3261 with synthetic Supabase URL/key (`http://127.0.0.1:54461`, `test-anon`, `test-service-role`), then `node scripts/tests/chat-dm-send-focus-browser.mjs`. Fixture users and messages are synthetic. No backend, migration, entitlement, or message-send semantics changed. Mobile coverage uses Chromium emulation, not a physical device keyboard.
