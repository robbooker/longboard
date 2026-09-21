# Opening unread conversations

On opening or reopening a DM or room, select the most recent incoming unread message; when there are none, open at the latest message. Cached drafts and messages remain useful, but an old saved scroll position no longer wins on reopening. An explicit room notification/deep link takes priority. User wheel, touch, or keyboard input cancels a delayed automatic opening scroll.

`GET /api/chat/opening` reads the authenticated account's durable marker before the UI acknowledges reading. Room replies resolve to their root within the authorized room with bounded traversal. DM lookups require membership in the conversation, a non-declined status, and no block in either direction. All responses are private/no-store. No schema changes.

An old DM anchor gets 25 messages on either side, with explicit earlier/newer controls. Forward pagination uses sequence cursors and does not merge an unrelated latest page across a gap. Sending is paused until newer context has loaded, because the existing server send action advances the conversation's read cursor. Read acknowledgments use visible rows and cannot advance beyond an unresolved gap. Slow responses are scoped to the selected conversation and authenticated identity. Room reads stay at the opening snapshot until the user reaches the bottom; an old root is retained by bounded authorized history lookup.

Membership Badges PR327 was published first. This branch is rebased onto 27a09ae22450f7f29a581d0e1251f0da79e5eed8. Both new DM response branches use the same trusted membership projection; retained room roots are included in the existing batch.

Validation:
- Full unit suite: 711 tests in 94 files passed after rebasing onto the published badge changes.
- Production build, TypeScript, focused ESLint, and all 71 release-service contract tests passed.
- 22 focused unit cases cover identity, room access, participant read cursors, blocked/declined conversations, incoming/deleted filters, nested/deleted/cyclic roots, bounded context, forward pagination, invalid/conflicting cursors, and authorized root retention.
- Chromium fixture renders the actual DirectInbox and PublicChat components with synthetic HTTP responses, at 1440px and 390px. Checks unread positioning, snapshot-before-read, no unseen newer read, gap-free paging, cached reopen to latest, delayed user-scroll cancellation, and room deep-link priority.
- No production accounts, messages, memberships, or read markers were changed during these tests.

Run `node scripts/tests/chat-unread-opening-browser.mjs` for the browser matrix. It starts an ephemeral loopback server and removes its generated bundle afterward. Browser fixtures validate UI behavior; mocked route tests validate API guards. The release HTTP probe alone is not an authenticated production acceptance test.
