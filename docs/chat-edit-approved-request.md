# Edit approved development requests

The private feature-channel owner can edit an approved request's title and scope until development picks it up. Saving explicitly keeps the revised scope approved, increments the revision, refreshes approval attribution/time, and updates `proposal` and `approved_proposal` together. Full previous/revised titles and scopes are retained in two bounded audit messages. Publishing still requires its separate approval.

Authorization uses `chat_feature_members.role = owner`; an ordinary application administrator or participant gains no new permission. The additive service-role-only `edit_approved_chat_feature` RPC locks the request row, matching the existing worker claim lock. An edit that wins is visible in the claimed snapshot; a claim that wins causes the edit to fail. Stale revisions, claimed markers, release records and non-approved statuses reject edits. Existing discussion proposal edits are unchanged.

Verification: 18 targeted API/regression tests passed, including verified actor, participant/outsider denial, validation and conflict reporting. The isolated PGlite suite covers authorization, stale revisions, full audit, atomic approved snapshot, both serialized edit/claim orderings, claimed markers and participant discussion edits. PGlite is single-session: this does not claim multi-session contention testing. Real locking follows the shared PostgreSQL row-lock statements.

Chromium browser verification exercises actual API/database title/scope saves, stale revision draft retention, pickup while editing, and participant denial. Mobile390px fits without horizontal overflow; screenshot `/tmp/edit-approved-mobile.png` was visually inspected. Physical mobile devices were not tested. TypeScript, targeted ESLint and production build passed.

Migration `20260918134410_chat_edit_approved_request.sql` was generated with the Supabase CLI and is additive/backward-compatible. Its SHA256 is pinned in `.release/62b0138a-d09d-4949-88e3-b84bc3b77da1.json`. The login-page probe verifies public HTTP smoke coverage, not authenticated editing. Apply migration before the new application version; no production changes were made during implementation.

Reproduce locally with `node scripts/tests/chat-edit-approved-database.mjs`, the targeted Vitest files, and `node scripts/tests/chat-edit-approved-fixture.mjs` (54463). Start Next on3263 with synthetic Supabase URL and `test-anon`/`test-service-role`, then run `node scripts/tests/chat-edit-approved-browser.mjs`. All accounts and messages in this fixture are synthetic.
