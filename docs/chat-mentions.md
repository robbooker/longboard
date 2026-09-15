# Public chat mentions and opening position

Signed-in members with a linked chat name can type @ and choose a linked member by name. Suggestions support spaces and Unicode names; up/down changes the selected option, Enter inserts it, and Escape dismisses suggestions. Enter sends normally once the picker is dismissed; Shift+Enter still adds a newline. Buddy remains available in suggestions.

GET /api/chat/mentions authenticates the account and verifies chat membership before returning at most ten public member IDs and display names matching the prefix. It exposes no account IDs, email addresses or private messages. Queries are bounded and SQL wildcard input is rejected/escaped.

Mentions remain ordinary readable @Display Name text in message history. The renderer highlights known linked participants (from loaded messages) and the current member's own name. This change does not add push notifications, unread mention counts or a separate mentions inbox. No database migration is needed.

The chat is constrained to the viewport and opens at the newest message after history and identity are ready. ResizeObserver keeps it at the bottom as content changes size while the reader is near the bottom. Scrolling upward stops automatic following; sending a message resumes it.

Validation: 172 tests, production build, and targeted lint pass. Local browser with isolated database: newest of 80 history messages visible on load, member suggestions, Enter-to-select then Enter-to-send, and highlighted persisted mention. No production messages sent during testing.
