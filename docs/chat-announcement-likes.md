# Announcement reactions

Eligible readers can toggle the existing palm reaction in LB ANNOUNCEMENT and lemon reaction in SS ANNOUNCEMENT. Counts, active state and reactor names use the existing reaction table and tooltip API. SS announcement emoji and accessible labels now consistently use lemon. Announcement posting, replies, edits and attachments retain their admin-only restrictions.

POST /api/chat continues to require authenticated current room access before any action. Only `react` joins `session` as exempt from the announcement posting permission gate. It still checks paused state, member identity, boolean reaction value and that the target belongs to the requested room.

Migration `20260917231038_chat_announcement_member_reactions.sql` removes only `announcement_reaction_writer`. These independent database guards remain:

- `shortscout_reaction_admin` calls the current `chat_account_has_room` entitlement check despite its historical name, including exact LB cohort and fresh SS identity requirements.
- `longboard_chat_reactions_require_open` checks the target message's room is open for inserts and updates.
- Announcement message and attachment admin triggers remain unchanged; browser roles retain read-only reaction grants/RLS.

Apply the migration before deploying the UI/API release. This worker created and tested the migration locally only; no production migration was applied.

Validation:

- `node scripts/tests/chat-announcement-likes-database.mjs`: eligible member/admin reactions and unlike; idempotent counts; cross-community, revoked cohort and expired SS identity denial; paused like/unlike/admin denial; browser write denial; retained announcement posting, attachment, bot, edit/read and revoked-admin protections.
- `node scripts/tests/chat-announcement-likes-browser.mjs`: Chromium → API → isolated SQL, both rooms at 1440px and touch-enabled 390px; like/name tooltip/count persistence/unlike; admin posting/reaction; non-admin posting/reply 403; paused UI/API 423; outsider/cross-community 403; anonymous 401; mismatched target 404; malformed reaction 400; no overflow or page errors.
- Dedicated fixture on 54414, app on 3214, synthetic credentials only. Shared fixture unchanged.
- TypeScript, targeted ESLint and production build passed; existing unrelated build warnings remain. Build log `/tmp/announcement-likes-build.log`.
- Browser log `/tmp/announcement-likes-browser.log`; screenshots `/tmp/announcement-likes-{lb,ss}-announcements-{1440,390}.png`.

No DM files, queue state, production data or deployment changed by this worker.
