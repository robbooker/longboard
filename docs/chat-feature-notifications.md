# Private feature notifications

Adds an in-app bell to the feature-request channel and its members' main chat header. The bell polls every 15 seconds while the app is visible and refreshes when returning to it. It is not browser push; the inbox persists while users are offline. Notifications link to `/chat/features?request=UUID`, automatically opening the request and marking the selected alert read.

Recipients and defaults:

- New request from Jammie: Rob.
- Human reply: the other private channel member. `@Rob`, `@Robbie`, and `@Jammie` classify explicit mentions; no duplicate reply alert.
- Codex reply: both private members, covering the questioner and the other participant.
- Approved or declined: Jammie.
- Development started, ready to test, published: both members.
- Blocked/needs decision: Rob. Ready and blocked alerts are visually highlighted.
- Progress-only system messages are quiet to avoid duplicate status notifications.

Delivery is a database trigger in the same transaction as the event. Recipient/event uniqueness prevents duplicate inserts. Existing events are not backfilled. Current membership is checked on creation and every authenticated inbox API call. All new tables enable RLS with no client role grants; there is no public feed, Realtime channel or search indexing. Deleting a private membership cascades that user's preferences, mutes and inbox records.

Users can mark one/all notifications read, mute the current request, or choose future event categories. Muting suppresses all future alerts for that request, including important alerts. Existing alerts remain. Mark-all uses the newest loaded notification timestamp so a concurrent new event stays unread. The latest 100 alerts are shown, with an exact count across all unread alerts.

Only Rob sees “Approve merge & publish” when a ready request has a registered release. The second confirmation queues that exact PR head/version for the desktop worker. Approval and publishing-started alerts go to both members; failures alert Rob. Only verified worker completion records done and emits published notifications. See [release worker](chat-feature-release-worker.md).

## Rollout

Apply 20260916174554_chat_feature_notifications.sql before deploying this version. The migration is additive except for extending the request status constraint to allow done. The previous production code remains compatible. Test the signed-in bell and signed-out 404, then inspect runtime logs. No worker automation change is required: its existing status updates automatically emit notifications after the migration.

## Verification

256 unit/API tests; 36 notification database checks; 22 existing feature database checks; production build, TypeScript and targeted lint passed. Database checks cover denied browser access, recipient routing, mention boundaries, no self-alerts, preferences, mutes, rollback, deduplication, revoked membership, worker states and owner-only completion. API checks cover account scoping, forged recipient input, validation, cross-origin requests and failed writes. Isolated browser verified four seeded alerts, request deep links, unread 4→3→0, persistent mute/preferences, Escape focus restoration and no console errors. No production data was changed or test messages posted.

## Optional sound alerts

Notification preferences include a browser-local sound toggle (off by default) and Test sound button. A short synthesized chime respects device/browser volume; no external audio asset or service is used. Browser audio requires user interaction. Saved opt-in is restored, and the next click or keypress unlocks audio. If audio is blocked or unavailable, the inbox explains this and visual notifications keep working.

The first successful inbox load silently baselines existing items. Later fetches chime once per batch containing newly arriving unread notifications; repeated polling, read alerts and older items do not replay. Polling remains limited to visible pages. Turning sound off closes the audio context immediately. Reloading does not play accumulated old alerts. The setting applies to this browser, including its other tabs, rather than syncing across devices. Multiple visible tabs can each alert. This covers the existing private feature inbox, not new room-message, DM, operating-system push or background-phone notifications. No database migration is needed.
