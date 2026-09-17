# Archive feature tickets before pickup

Request: 2eee15c1-d5fb-470d-87a3-9a2ea17f4ed2

- [x] Owner-only Archive ticket button on discussion/development-approved tickets with no claim or release.
- [x] Preserve request and discussion history with archive time and actor; remove from active list and worker eligibility.
- [x] Serialize archiving against pickup with the existing request row lock; reject stale revisions and already claimed work.
- [x] Mark old notifications read so cancelled work does not remain an unread alert.
- [x] Verify database permissions, both archive/pickup orderings, API permission and revision checks, persisted browser removal and mobile layout.
- [x] TypeScript, targeted ESLint and production build.
- [ ] Owner-approved merge, migration, production deployment and live verification.

Deployment: apply `20260917151325_chat_feature_archive.sql` before publishing the app. This additive migration preserves all history and does not change existing claims. No environment variables are needed. There is no restore/archive browsing UI in this version.

Verification commands: `node scripts/tests/chat-feature-archive-database.mjs`; run `chat-mobile-fixture.mjs` plus the local app, then `node scripts/tests/chat-feature-archive-browser.mjs`.

The Supabase security advisor reports pre-existing warnings unrelated to this change. The new RPC uses SECURITY INVOKER, a fixed search_path, and service-role-only execution; isolated tests verify anonymous/authenticated denial and the owner check.
