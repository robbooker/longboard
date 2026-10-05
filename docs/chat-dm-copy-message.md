# Copy message in DMs

Approved request `6ae55fce-6182-47fb-ac21-c8a8cbf1d8d4`, revision 2. Based on published main `3e57bf6d82f111e4febd5f1d15a506dc094c4b15` including the inbox history optimization.

## Behavior

Every visible DM text bubble has a copy button in its action area: received messages, sent messages, local sending/failed messages, and private Buddy summary deliveries. It appears on mouse hover or keyboard focus and remains visible on touch devices. The control has an accessible label and announced success/failure feedback. Attachment-only messages show a muted disabled control labeled “Media message — no text to copy.” Deleted DMs remain filtered out by the existing renderer. Group-room messages do not receive this control.

Copy sends the exact stored/captured `body` string to the browser clipboard, preserving leading/trailing spaces, newlines, Unicode, literal markup, and original URLs. It never scrapes displayed link labels, formatted previews, author names, or timestamps. A GIF shown as “GIF ↗” copies its original URL. The existing send-time text normalization is unchanged.

The browser's Clipboard API is invoked directly from the button interaction. Success is announced only after its promise resolves. If unavailable or denied, the message explains that copying failed and suggests retrying or selecting the text. There is no permission request during render, hidden clipboard read, deprecated fallback, or backend copy endpoint. See the [Clipboard.writeText documentation](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText) for the secure-context and permission behavior.

Feedback is placed toward available space inside the conversation. It expires after success and remains available after failure. Completion after a body change or unmount is fenced by a local request version. Copy does not modify drafts, message history, read markers, navigation, permissions, or message edit/delete/reaction controls. Timestamps can wrap within their identity column in narrow panes so the added control cannot cover their text.

## Implementation boundaries

`DirectMessageCopy.tsx` and `chatDmCopy.ts` are DM-only. `DirectInbox.tsx` inserts the control in canonical and local pending message headers. Styles stay in `DirectInbox.module.css`; shared message-action styles and room rendering are untouched. No API, schema, migration, Supabase authorization, polling, or release-service changes are included. The migration-free release plan retains the standard unauthenticated login probe; that live probe does not verify authenticated clipboard behavior.

## Local evidence

All data and accounts are synthetic. Verification uses production-mode Next on port 3371 and the existing current-schema PGlite/Auth/storage fixture on 54571. The local preload redirects only the fixed membership-export destination and mocks the malware-scanner response for a test GIF; upload, attachment binding, send, and read routes are real application code. No real summaries are generated and no production data or credentials are read. Clipboard read-back follows writes of known synthetic text.

- **959 unit tests / 117 files pass.** Nine focused copy tests cover exact unmodified strings, attachment-only rejection, missing API, and denied writes.
- **49 inbox history database checks pass**, retaining the latest published long-history optimization's semantics. Sequential PGlite is not a native concurrent-session proof.
- **71 release-service regressions pass.** TypeScript and production build pass. Lint has **0 errors and the existing 10 warnings**.
- The production Chromium 152 matrix verifies actual clipboard read-back for received/sent whitespace, multiline text, Unicode, literal markup, long messages, and original GIF URLs. It checks keyboard focus, unchanged composer draft/read cursors/history URL and length, deleted-message absence, and no room copy controls.
- Controlled clipboard denial/unavailability produces visible failure feedback, including feedback bounds inside the conversation; retry succeeds. A held completion after a real DM edit cannot announce success on the edited message, and a new copy uses the new body.
- A real local GIF upload and attachment-only send yields the disabled control without changing clipboard text. Local sending and failed bubbles can copy their captured body. Private summaries remain copyable within their existing DM interface. Existing edit and reaction controls remain reachable.
- The final matrix covers 320px touch layouts in all three themes and a DM in Quad, checking complete timestamp bounds, no document overflow, and zero browser runtime errors. Local screenshots under `/tmp/chat-dm-copy-{dark,light,blade-runner}-320.png` and `/tmp/chat-dm-copy-quad.png` were visually inspected.

The headless Linux browser reports no primary mouse pointer. The desktop hover test therefore forces only the condition of the shipped hover CSS rule in the test page, then exercises the original declarations with actual pointer hover and keyboard focus. Touch media behavior, application code, and clipboard operations are not stubbed for those cases. Chromium's test context explicitly grants clipboard read/write/sanitized-write permission to the localhost origin; separate tests replace that API only for deterministic failure and delayed-completion scenarios. This is desktop/mobile emulation, not physical iOS/Safari or Android verification.

Reproduction entry points: `scripts/tests/chat-dm-copy-fixture.mjs`, `chat-dm-copy-preload.mjs`, and `chat-dm-copy-browser.mjs`. Evidence logs: `/tmp/chat-dm-copy-{focused,unit,build,tsc,lint,db,release,browser}.log`. Owned local servers are stopped after verification. Publication remains the coordinator's responsibility through the dedicated release service.
