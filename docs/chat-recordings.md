# Recording channels

LB RECORDINGS (`lb-recordings`) and SS RECORDINGS (`ss-recordings`) are root-post channels. They reuse announcement publishing and notifications, with a distinct recordings label. Admins can post attachments, edit their own posts, and delete posts under the existing moderation rules. Replies are unavailable for everyone, including admins. Entitled readers can use all existing reactions, including Rob.

Access follows the current corresponding chat membership: LB requires a Longboard profile and cohort 1 or 2; SS requires the verified mastermind entitlement, including a valid linked identity. The existing Longboard admin override applies to both. No membership is inferred from labels, browser input, or a reaction. Existing channels retain their behavior.

The shared room catalog/parser and access functions supply room APIs, updates, bootstrap/history, attachments and scanning, notifications, favorites, quad options, unread markers, reaction details, and member directories. The recording feed uses the same authenticated update polling as announcement feeds. The LB/SOCIAL search index remains scoped to its existing supported rooms. Recording alerts survive edits and do not create duplicate unread alerts. Login return-room parsing preserves direct recording URLs.

`20260924153337_chat_recording_rooms.sql` is an additive CLI-generated migration. It extends allowlists and latest function definitions, preserving SECURITY INVOKER and existing service-only grants. The announcement writer trigger now covers recordings; the existing entitlement and pause reaction triggers remain active. A CHECK constraint rejects recording replies on both INSERT and UPDATE, including service-role writes. The API rejects recording reply sends and thread reads, and the component hides both reply actions and restored reply panels.

## Verification

- `npm test -- --reporter=dot`
- `./node_modules/.bin/tsc --noEmit --pretty false`
- `node scripts/tests/chat-recordings-database.mjs`
- Start `node scripts/tests/chat-recordings-fixture.mjs` (synthetic PGlite on 54544).
- Start Next on 3344 with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54544`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key`, `SUPABASE_SERVICE_ROLE_KEY=test-service-role`, and `NEXT_PUBLIC_SITE_URL=http://localhost:3344`.
- `node scripts/tests/chat-recordings-browser.mjs`
- `node scripts/tests/chat-pins-database.mjs`
- `CHAT_TEST_URL=http://localhost:3344 CHAT_FIXTURE_URL=http://127.0.0.1:54544 node scripts/tests/chat-pins-browser.mjs`
- `node --test scripts/tests/chat-release-service-test.mjs` (requires local HTTP-listen permission)

The database fixture loads the current relevant migrations through membership links, membership projections, and Rob reactions before the recording migration. It verifies service/admin root-only writes, member and bot post denial, admin edits/deletes/attachment reservation, eligible reactions, pause/revocation/expiry checks, cross-membership denial, notification/read behavior, favorites, and client-role privilege boundaries. The browser fixture exercises the actual Next components and endpoints with synthetic accounts only.

## Integration

PIN PR 342 was published through the dedicated release service (run `36069816287`) at main commit `27fd1eb4f1e949e573ec04a42e82a22b772d67b8`. That published main commit was merged into the existing recordings branch, preserving its already-pushed history. The published PIN migration and registered head are unchanged.

The CLI-generated additive migration `20260924225620_chat_recording_pins.sql` expands only the PIN room constraint for LB/SS recordings. The existing pin RPC continues to validate room access on every mutation/read. Both recording migrations and their exact SHA256 hashes are registered in the recordings release plan; PIN's already-published migration is not reapplied by that plan.

Combined validation includes the recording and PIN database suites, the complete unit suite, TypeScript, production build, and real desktop/mobile browser flows. Recording pin tests cover settings pin/unpin, reload persistence, sidebar navigation, independent LB/SS access, admin access, revoked entitlement disappearance, idempotence, and anonymous/authenticated database privilege denial. Parent independently reviewed the additive migration and access tests. Only the dedicated release service may merge, apply production migrations, and publish.

Final combined results: 806 unit tests across 101 files, 71 mocked release-service tests, both SQL suites, both Chromium suites against `next start`, TypeScript and focused ESLint passed. Production build passed with existing unrelated lint warnings. Recording mobile pin screenshots were inspected. Test servers use synthetic data only and are stopped after verification. No production mutation is performed by these tests.
