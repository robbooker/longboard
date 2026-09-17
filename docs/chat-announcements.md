# Announcement channels

LB ANNOUNCEMENT is available to Longboard members. SS ANNOUNCEMENT is available to verified ShortScout members and Longboard admins. Both appear in the existing room navigation. Members can read posts and existing threads; only admins can post, reply, edit their announcements, react, or upload attachments in these rooms. Admin moderation retains the existing delete rules.

Each new announcement post creates one durable in-app bell alert for every existing chat account in its membership group (including admins). Edits do not send another alert or reset read state. Deleting a message removes its alerts. Alerts open the announcement directly and use the existing unread counts/read cursors. This does not add email, SMS, or OS push notifications.

ShortScout identities remain eligible to receive alerts while offline. The inbox, channel history, thread routes and private attachment downloads still verify current access before returning data; expired SS verification must be renewed before reading. Announcement messages use the authenticated server feed rather than broadening browser database policies. Announcements are outside the existing LB/SOCIAL search and AI-summary paths.

## Rollout

Apply `20260917135451_chat_announcement_rooms.sql` from the exact approved PR before merging/deploying. It adds two room-state rows, extends private attachment/alert room constraints, adds admin-write guards, extends server-side room access checks, and creates notification fanout. No new secrets or services. It is compatible with the old UI; no production migration was applied during development.

The alert table remains service-only with RLS. Database triggers reject non-admin announcement message, reaction and attachment writes, including fabricated bot posts. The message mutation RPC also rejects former admins. API checks duplicate these protections. Existing non-announcement room behavior is retained.

## Verification

- 329 unit tests, TypeScript, targeted ESLint, and production build.
- `node scripts/tests/chat-announcements-database.mjs`: admin-only writes; LB/SS recipient separation; private alerts; read state survives edits; alert deletion; attachment/bot denial; revoked-admin mutation denial.
- `node scripts/tests/chat-announcements-browser.mjs` with the isolated chat fixture and local app on localhost:3204: admin posts in both channels, matching membership alerts, bell navigation, read-only member UI, direct API rejection, SS-only access denial for LB, and 320/390/768/1440px layout checks. Waits for saved posts rather than optimistic drafts and respects the existing posting rate limit. Chromium only; physical Safari testing remains manual.
