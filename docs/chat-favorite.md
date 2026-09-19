# Chat favorite

Each registered chat member can keep one favorite room or accepted private conversation. Room controls and the shortcut live in the existing chat settings menu, preserving the narrow mobile header. The DM control is in conversation settings. Selecting another target replaces the previous favorite; removing it hides the shortcut.

`GET /api/chat/favorite` returns `{favorite:null}` or a public room/conversation target and label. `POST` accepts `{favorite:null}`, `{favorite:{kind:"room",room:"social"}}`, or `{favorite:{kind:"dm",conversationId:"UUID"}}`. The server derives the account from the authenticated session and checks mutation origin. Responses are private and uncached.

The service-only SQL functions validate registered identity, current room entitlement, accepted DM participation, the other member's entitlement, and blocks in either direction. One row per account enforces the single selection. Direct browser database access is revoked and RLS is enabled. Unavailable saved targets resolve to null; they are retained so temporary access changes do not silently erase a preference. Quick navigation revalidates the target, then uses the existing cached room/DM navigation. It cannot send a message. Request generations discard work after unmount/account changes; focus refresh skips pending writes/navigation.

Migration: `20260919172700_chat_favorite.sql`, additive and registered in the ticket release manifest. Only the dedicated release service may apply it to production.

Verification commands:

- `npm test`
- `node scripts/tests/chat-favorite-database.mjs`
- `npx tsc --noEmit`
- `node scripts/tests/chat-favorite-fixture.mjs` and a local Next server on 3278 with synthetic Supabase URL `http://127.0.0.1:54478`, anon key `test-anon`, service key `test-service-role`, site URL `http://localhost:3278`; then `node scripts/tests/chat-favorite-browser.mjs`.

The browser fixture is entirely local and contains synthetic accounts. It verifies persistent selection, account isolation, a 320px menu, cached navigation, mutation focus races, discarded unmounted navigation, DM selection, revoked access, and clearing.
