# User Name Updates

Ticket: `2e83031a-dc30-4f86-86c2-1e4234d965a6`, approved revision 2. Published base: `3dde38b6979435d979d88645c65c2c06b5ef51e6`.

Signed-in members can open **Profile settings → Change Name** in the chat menu or Quad toolbar. The dialog explains that this changes the chat display name only, asks people to use their real name so fellow traders recognize them, and presents save/error feedback. The reminder is guidance, not identity verification. Ordinary Longboard, paid ShortScout and combined accounts use the same flow; administrator status is not required.

## Identity and authorization contract

`POST /api/chat/member` adds `action: "rename"` and `displayName`. The existing missing-action link flow and its SQL function remain unchanged. The server derives the account from `requireChatUser`; submitted account/member IDs cannot select a target. The service-only `chat_update_member_name(uuid,text)` RPC is `SECURITY INVOKER` with an empty search path. It uses the existing per-account linking advisory lock, locks the member row, and then checks strict Social-room eligibility. Annual ShortScout remains eligible to rename, even though it cannot enter the Mastermind-only SS room. A denied SS-only identity is rejected by existing authentication.

Names retain the established 2–28-character policy, Unicode letters/numbers and ordinary punctuation, with NFKC and whitespace normalization. Existing reserved application names stay reserved. A small explicit whole-word list rejects clearly inappropriate names without rejecting ordinary substrings such as Scunthorpe, Dick Smith or Ashit Patel. This is a narrow validation rule, not comprehensive moderation. Rob and Jammie are not newly reserved. Existing case-insensitive uniqueness is enforced by the member-name index, including competing saves. Invalid, unavailable and collision responses are presented without exposing SQL details.

The additive `longboard_chat_members.name_revision` starts at zero and increments only when the name changes; a normalized no-op returns the current revision without a write. Account/member/guest IDs, login and guest credentials, source identities, membership grants, session expiry and DM settings do not change. The existing same-ID guest display label is updated alongside the member. No message body, stored author snapshot, historical `@mention` text, message revision, read marker, notification row or push event is changed or generated.

## Projection and client propagation

Room history, replies and authorized search/context results display current member names. The server queries only member IDs already present in authorized rows, in batches of at most 200; legacy search first resolves only its already-authorized message IDs. It never infers identity from author text or guest credentials. Bots retain their label. Name lookup runs independently of membership-badge/source success and falls back to the stored label on lookup failure. Search matching and indexes are unchanged: historical author text may still match, while the returned label is current.

The existing activity SQL projection joins current names for authorized mention/reply rows. DM names, reaction authors, members, mentions, pins and Quad choices already read current member records. Existing counts, authorization/block/deletion predicates and notification cursors are retained. The activity response remains subject to its existing 32 KiB serialized budget.

The shared update batch adds one optional, validated self-member record to its existing access metadata. Its name is bounded to 28 characters, with one stable UUID, boolean and safe integer revision. There is no new request stream or polling interval. Older-server omission is tolerated. Once a newer revision is known, an omitted or lower revision cannot replace it.

A successful save updates the account-scoped shared identity immediately. Composer labels, self-authored room/reply/search labels, mounted Quad panes and restored room snapshots use that identity. Pending history/send acknowledgements cannot overwrite the displayed self name; drafts, ready uploads and scroll snapshots are preserved. Refresh cancels obsolete shared reads while preserving realtime health and the existing healthy reconciliation cadence.

Already-mounted reaction/member/mention surfaces refresh on a scoped name change. Other viewers receive current names through existing history/inbox/Quad reconciliation; a changed peer name observed in an existing conversation triggers bounded invalidation of cached pin/favorite labels and open name surfaces. This does not promise instantaneous updates on every other client or an already-open historical search. New authorized reads show current labels, subject to the documented lookup fallback.

Save completion is fenced by the expected account, stable member ID, request generation and cancellation state. Replacing the owner closes the dialog and clears its busy state. A delayed response cannot publish the prior identity into the next session. Name broadcasts are display updates and invalidation signals, never authorization evidence.

## Validation

- Full unit suite: **886 tests in 110 files**. Coverage includes normalization, reserved/prohibited names, ordinary Unicode/punctuation, route ownership/denial/collisions, badge-failure-independent bounded projection, monotonic and old-server name revisions, cached snapshots, delayed reads and the exact nonzero healthy reconciliation cadence after rename.
- Name database suite: **44 assertions** using the actual migration chain. Ordinary LB/SS/combined identities, atomic collisions, no-op/revision behavior, stable IDs/credentials/messages/read state/notification counts, current activity authors, legacy linking, strict access and service-only grants pass.
- Existing related database suites pass unchanged: Pins **28**, Formatting **49**, exact visible notifications **35**, ShortScout authorization **105**, attachment-only sending **69**. These preserve the surrounding authorization, notification and sending contracts.
- TypeScript passes. ESLint has **0 errors and 10 existing unrelated warnings**. The production Next build and all **71 release-service regression tests** pass.
- The actual profile component also passes an isolated Chromium race probe: during a held successful save, both account replacement and same-account member replacement close the dialog, leave Save enabled on reopening, and discard the old completion without publishing or showing success.
- The complete real-app browser matrix passes against the production build with **zero browser errors**: empty/inappropriate/collision validation; Enter save and Escape close; reminder/feedback; unchanged stored historical labels/bodies/revisions; current room/reply/search labels; open peer reactions/member list/mention suggestions and pinned DM header; 1440px desktop, 320px mobile, mounted/remounted Quad; cached room/reply identity and room drafts; ready-upload preservation; persisted SS-only and combined-account saves; annual versus denied SS access; anonymous rejection; and a held successful rename response across real local Supabase logout followed by a different account in the same browser context. The final log is `/tmp/chat-user-name-updates-production-browser.log`.
- Independent read-only review cleared the implementation and exact manifest, and separately passed **47 focused units**, the **44 database assertions**, and the actual profile owner-change Chromium probe. The coordinator verified that published main remained the stated base before commit.

The browser fixture uses the built Next app, actual API handlers and current SQL with synthetic auth/source/scanner data on ports **3358/54558**. PGlite executes sequentially; collision/locking assertions and code review do not constitute native PostgreSQL multi-session concurrency testing. Responsive Chromium widths are not physical-device tests. No production credentials, accounts or data are used.

Browser scripts are `scripts/tests/chat-user-name-updates-browser.mjs` and `scripts/tests/chat-profile-owner-browser.mjs`. The fixture is `chat-user-name-updates-fixture.mjs`, with the local-only scanner/source preload `chat-user-name-updates-preload.mjs`. Logs and desktop/320px/Quad screenshots use `/tmp/chat-user-name-updates-*`.

## Release compatibility

The migration adds a defaulted member column and a new service-only function, and preserves the signature, grants, counters, cursors and eligibility predicates of the existing activity function. The published application's legacy link/read calls continue to work after migration; name projection is a display-only difference. Historical message indexes and triggers are untouched. The exact migration SHA-256 is recorded in `.release/2e83031a-dc30-4f86-86c2-1e4234d965a6.json` with `backwardCompatible: true`.

This worker implements, tests and commits locally. The coordinator retains push, hosted checks, exact-version registration/authorization, dedicated release-service dispatch and live verification. No release safeguards or publishing infrastructure are changed.
