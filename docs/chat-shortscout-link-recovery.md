# ShortScout membership connection recovery

Ticket: 44048249-9aac-43e7-9c0f-409606459b1c.

An existing standalone ShortScout profile can now lend its verified membership to the same person's Longboard profile after the existing dual-provider handoff proves both identities. This does not merge profiles or inboxes. No existing messages, memberships, conversations, sessions, or provider identity owners are moved or deleted.

## Identity and authorization

`chat_shortscout_membership_links` records a one-to-one Longboard account → original ShortScout identity association. A composite foreign key pins the original identity owner. Only the service role accesses this table and the narrowly scoped resolver/revocation functions. The browser cannot nominate a different source account. The handoff holds a subject advisory lock, then the Longboard target account row lock, then the standalone source row; target and source classes cannot overlap in a successful bridge. Unique constraints enforce both directions.

`chat_shortscout_identity` resolves current original membership proof rather than copying a tier. The existing 12-hour freshness window and exact Mastermind requirement continue to apply. Revocation removes only the bridge. Ordinary ShortScout sign-in refreshes its own membership proof but cannot reactivate a revoked bridge; a new explicit dual-proof connection can. Reconnecting a different identity or connecting the source to a different Longboard account is rejected even after revocation.

Room access, membership badges, and announcement recipients share this resolver. Cookie-only sessions retain ordinary user role and do not gain private Longboard admin privileges. Gainers remains available to eligible chat members and remains read-only.

## Member-facing flow

Successful linking explains that historical profiles and inboxes remain separate. The menu exposes the original ShortScout profile option. Switching prepares a non-linking handoff pinned to the known original ShortScout subject, disables current-device chat push, signs out the chat session and local Longboard browser session, and confirms that the server sees no Longboard session. Any failure stops navigation. The member sees an explicit warning before local unsaved chat drafts are cleared; other devices are not signed out. A wrong ShortScout account cannot complete the pinned handoff.

Callbacks show friendly allowlisted recovery messages instead of raw database errors. Existing Longboard access remains available when a connection fails.

## Verification

- 751 unit tests across 97 files.
- All 35 database suites, including actual migration tests for unchanged original histories and two distinct DM inboxes, freshness, downgrade, revocation, explicit reactivation, actor binding, competing targets/sources, replay, expected subject, private grants, badges and announcement recipients.
- 71 release-service tests.
- TypeScript and targeted ESLint checks.
- Production Next.js build.
- Actual switch component in Chromium at 320, 390 and 1440 pixels: readable warnings, no horizontal overflow or JavaScript exceptions, failed server logout confirmation stops navigation.

PGlite serializes test operations. The suite tests queued competing claims and SQL uniqueness, but does not prove multi-connection lock scheduling. A Docker-backed concurrency check was unavailable because this worker cannot access the local Docker socket; no local PostgreSQL server binaries were present. No production accounts were used in tests.

## Release

Apply the single additive migration via the dedicated release service before deploying the app. It keeps the existing consume RPC signature and existing account IDs; older app versions continue to work with the extra JSON return field. Deploy the matching app and verify anonymous sign-in/recovery probes plus a controlled dual-provider account pair. Users retry the existing explicit Connect ShortScout flow; there is no bulk repair. Do not roll back by deleting/reparenting original identities or removing association tables. If app rollback is necessary, retain migration and history; bridge-only access may then require the fixed app to be restored.
