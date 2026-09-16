# Desktop chat workspace

At widths of 1100px or more, room navigation moves to the left column and chat occupies the center. Reply opens a right column; closing it restores the two-column layout. Navigation uses Next.js links in the current window, with existing server-side membership gates. Own-message colors use theme variables, including ShortScout themes.

The reply panel fetches the parent and latest 100 direct replies through an authenticated, room-scoped endpoint. Existing message writes accept a validated replyTo ID and retain membership, room-paused and rate-limit checks. Replies remain visible in the normal room stream, with a link back to the parent conversation. The parent/reply relationship uses the existing reply_to_id column. Deleted parents produce an unavailable state; existing foreign-key semantics leave surviving replies as standalone messages. The additive chat_thread_lookup migration indexes these reads and should precede deployment.

Narrow screens receive a focused overlay fallback with close/Escape and keyboard focus containment. This does not mark the separate mobile Reply to Comments proposal complete: full nested reply navigation, animation and reply counts remain separate follow-up scope. Threads here show direct replies only and explicitly report when only the newest 100 are shown.

Validation: authenticated API tests cover unauthorized rooms/accounts, malformed and missing parents, database failures, correct identity and reply links. Browser fixture verifies desktop geometry, actual reply persistence, SPA Features navigation, mobile fit, Escape close and return focus. No production data was changed for browser tests.
