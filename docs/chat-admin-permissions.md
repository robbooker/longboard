# Jammie's existing administrator permissions

Ticket `8a5df9f4-6fce-46ea-a26f-665eb705f7fa`, approved revision 2, based on published `e99d763`. Rob clarified on October 2, 2026: “She can have full power. She's responsible.” The implementation grants the existing site administrator role and existing chat control ownership to Jammie's exact trusted account. It does not create a new role or change how any authorization check works.

Use the normal Longboard sign-in for administration. Existing sessions read the current profile role on each authenticated server request; reload an already open page to reveal its admin controls. A linked ShortScout-only chat cookie still has `user` authority for privileged mutations and cannot open the site administration area.

| Existing capability | Where and limits |
| --- | --- |
| Site administration | `/admin` and the existing admin pages, including users, invitations, tags and content controls. This is the full existing site role, not a chat-only moderator role. |
| Grant/revoke other administrators | Users table Promote/Demote controls. The existing prohibition on self-demotion remains. Promoting a user does not also add them to the separate chat-owner table. |
| All eight existing rooms | LB, Social, SS, both announcement rooms, Gainers and both recordings rooms. No cohort or ShortScout membership needs to be added to this account for the existing administrator exception. |
| Pin/unpin room messages | Existing pin controls in all eight rooms, including Gainers and recordings. Existing limits and target validation remain. |
| Moderate room messages and replies | Existing “Delete as admin” action for other users' messages; own edits/deletes retain their existing behavior. Gainers is an automated read-only broadcast channel and retains its write/deletion restriction. Administrators do not gain permission to edit other people's message text. |
| Announcements and recordings | Existing administrator posting controls. No new channel types or publishing jobs are introduced. |
| Room settings | Chat settings → Admin controls: pause/reopen, optional pause notice, existing summaries and submitted-report review. Summary generation is available through the existing guarded control; this change does not invoke it. |
| Direct messages | Ordinary conversation and attachment access remains participant-only. Chat control owners can inspect messages in a conversation submitted through the existing report flow. A report does not grant ordinary inbox/attachment access or permission to delete other people's DMs. |

The room catalog is fixed in `lib/publicChat.ts` and the database. There is no arbitrary channel creation, renaming, deletion, or general server/group-settings screen to unlock. This permission grant adds none of those product capabilities. The existing read-only Gainers behavior, private-message boundaries, and the separate feature/release ownership are preserved.

Jammie remains a feature-channel participant with the existing development-approval permission. This grant does not make her the release owner, permit publishing approval, alter feature priorities or owner-only feature operations, or change the dedicated release service. The coordinator registers and authorizes the exact reviewed version; the existing service remains the sole publisher.

## Migration

`supabase/migrations/20261002203642_chat_jammie_administrator.sql` was created with the installed Supabase CLI. Its single atomic `DO` block checks the exact account ID `6ad10d99-fe91-4955-86fa-a893b9763573`, the same linked profile/auth user ID, and the established trusted profile-email association. It locks the account and profile rows while applying the grant. Missing or changed associations raise `jammie_admin_trusted_association_mismatch` before any grant.

Only that profile's role and `updated_at` change, and only that user is inserted into `longboard_chat_owners`. A failure inserting the owner rolls back the preceding role update. Repeating the migration with the same already-granted state makes no further changes. No existing table, policy, function, trigger, application code or release infrastructure is modified. It is compatible with the currently published application and requires no coordinated client rollout.

The release manifest pins this one additive migration's SHA-256. Production application of it is reserved for the dedicated release service; all implementation tests use synthetic local data.

## Validation

- All 945 unit tests in 115 files pass. Production build and post-build TypeScript pass. ESLint reports zero errors and ten existing unrelated warnings. All 71 release-service safeguards and the exact additive-migration release plan pass.
- The new database regression passes 76 assertions: trusted exact/case-normalized association; wrong email, missing account/profile/auth and changed/null link rejection; forced owner-insert failure rolls back the role update; repeat application preserves the first grant's timestamps; same-email decoy and other profiles/owners remain unchanged. The test also compares all loaded public function definitions/grants and feature-member rows before/after, verifies access to all eight rooms, existing permitted-room posting/pins/moderation, private DM denial and release-owner separation.
- Existing regression suites pass: 56 deletion assertions, 63 room-message pin assertions, and 41 feature-release database checks.
- The actual production browser matrix passes with the unchanged application routes and current chat SQL. A pre-existing normal Longboard session changes from denied to admin after the local grant without changing its auth cookie. The existing `/admin` Promote/Confirm Promote and Demote/Confirm Demote controls persist their changes for another synthetic user. Ordinary users remain denied and self-demotion remains blocked.
- The same browser verifies all eight room history/pin/owner capabilities, visible pin/unpin and Delete as admin, nested-message deletion, visible pause/reopen controls and audit rows, and the Gainers write restriction. Unreported private conversations and attachments remain inaccessible; a submitted report permits the existing message-review path but still cannot open the ordinary inbox or attachment. Publishing approval remains forbidden and feature-member rows remain unchanged.
- A linked ShortScout-only session still cannot use site administration, pin/delete another member's room message, pause a room or inspect reports. Mobile chat settings expose the existing Admin controls at an emulated 390px width. There are no browser runtime errors or summary invocations. Desktop admin, paused room and mobile-menu screenshots were inspected.

The new regression files are `scripts/tests/chat-jammie-admin-database.mjs`, `chat-jammie-admin-fixture.mjs`, `chat-jammie-admin-preload.mjs`, and `chat-jammie-admin-browser.mjs`. The fixture uses current published chat migrations, synthetic Auth/PostgREST, and the real unchanged Next routes and components on local ports 3367/54567. It does not connect to production or send real messages, summaries, invitations or notifications. Browser checks use Chromium `152.0.7977.82`; mobile width is emulated, not physical-device evidence. PGlite execution is sequential; no concurrent native Postgres or live authenticated Jammie session is claimed.

Initial validation setup required the normal sandbox exception for loopback listeners/build resources. The browser harness was corrected to bind its synthetic file through the existing ready-to-attached trigger, reset its local migration connection's stale request JWT, and select the existing `CONFIRM PROMOTE`/`CONFIRM DEMOTE` buttons. These were fixture/locator corrections; the runtime and grant implementation did not change.

Evidence logs: `/tmp/chat-jammie-admin-{database,unit,build,tsc,lint,release,delete-regression,pins-regression,release-db,browser}.log`. Screenshots: `/tmp/chat-jammie-admin-{users,room,mobile}.png`. Migration SHA-256: `5658f3586cbc1a4fcd571fec6a51e12a3f7b7949f8b3ddd1c4a36570cb84d46d`.

Hosted checks, exact-version registration/authorization, production migration, publication and live verification remain with the coordinator and sole release service. This worker makes only the local implementation/evidence commit and stops its owned synthetic servers.
