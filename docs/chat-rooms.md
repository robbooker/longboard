# Main and Social

`/chat` opens Main; `/chat?room=social` opens Social. Popout and sign-in return links retain the room. The tabs reuse the same chat component and preserve each room's unfinished draft for this browser tab when switching.

Existing public history defaults to Main. History queries, new messages, Buddy context, presence, owner pause controls, audit events and private daily summaries are scoped by room. Reaction writes verify the target message belongs to the requested room; the database trigger checks that message's actual room is open. Rate limits remain shared across rooms. Identity, member mentions and the private inbox are shared. Buddy responds only in Main. Both rooms retain the existing public guest-access policy.

## Release

Apply `20260915204338_chat_social_room.sql` before deploying the new code. It adds Social and preserves existing Main data and permissions. It changes the summary uniqueness key to room plus date, so deploy the new summary code immediately afterward (the old summarizer cannot upsert against its former date-only key). Refresh existing open chat tabs at rollout: old client code has no room filter and can display messages from both public rooms until refreshed. Neither room is a private access boundary; DMs keep their separate RLS.

## Verification

- 174 unit tests; isolated PostgreSQL suite has 53 checks, including upgrade of existing history, independent room pauses, reaction enforcement, anonymous read/write permissions and existing DM privacy.
- Browser fixture: Main history retained, Social initially empty, Enter sends to Social, palm persists, Main draft survives switching, newest-message scroll retained, compact layout without horizontal overflow. Signed-in test member has the same unread inbox in both rooms; @Bob autocomplete inserts correctly in Social. Realtime presence cannot be exercised by the isolated HTTP fixture.
- Production migration and deployment pending release approval.

## SHORTSCOUT admin preview (pending release)

Main is displayed as **LB Main**; its `main` URL/storage slug and existing history stay intact. The new `shortscout` room is visible as a locked tab to regular members and accessible only to users whose trusted Longboard `profiles.role` is `admin`. This is not yet ShortScout membership authentication.

Admins see **SS ↘** in the header while in SHORTSCOUT; LB Main and Social retain **LB 🌴**. Server page/API checks and database message/reaction RLS enforce access. Database write triggers additionally reject non-admin authors/reactions, and role removal revokes subsequent database reads. Already-loaded content cannot be recalled. Admin room controls remain limited to the existing chat-owner role.

Apply `20260915232125_chat_shortscout_admin_room.sql` after the pending member-search and semantic-search migrations. SHORTSCOUT is not part of background embeddings or Main/Social searches; its Search tab still searches LB Main/Social. It has no automatic Buddy replies or scheduled summary job.
