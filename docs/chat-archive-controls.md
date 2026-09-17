# Ticket archive controls

Every ticket detail has an Archive control immediately below its heading. Rob can archive unclaimed Discussion, Approved and Declined tickets. Other members see the disabled control with an owner-only explanation. Claimed tickets and any ticket with an attached release remain protected; published and archived tickets say Already archived. Published tickets still enter Archive automatically, as introduced in PR274.

Active and Archive share case-insensitive title search and 50-ticket pages. Search runs in the database before pagination, so tickets beyond the old 100-ticket cutoff remain findable. Percent, underscore and backslash are treated literally. Search does not index proposal or discussion text. Selected ticket data/history is separate from filtered results, keeping old notification/deep links accessible without adding nonmatching cards. Status polling includes the selected ID even off-page.

Migration `20260917205526_chat_archive_declined.sql` replaces only the existing archive RPC, adding unclaimed declined eligibility. It retains the owner check, row lock shared with worker pickup, revision check, worker-token and release guards, audit metadata, notification clearing and history preservation. No live migration was applied by this worker.

Verification uses synthetic PGlite fixtures only:

- `node scripts/tests/chat-archive-controls-database.mjs`: denied database roles/non-owners, stale revisions, idempotency/audit/history, archive-before-claim and claim-before-archive orderings, protected work states, declined eligibility and attached-release rejection.
- `node scripts/tests/chat-archive-controls-fixture.mjs`: isolated fixture port54414; run Next on3214 with synthetic service/anon keys.
- `node scripts/tests/chat-archive-controls-browser.mjs`: real login → API → SQL; top control, archive persistence/history, mobile layout, search beyond100, literal wildcards/punctuation, pagination and API authorization.
- TypeScript and targeted ESLint passed. Production build passed (existing unrelated lint warnings remain).

The SQL test covers both lock outcomes sequentially in PGlite; it does not simulate two independent concurrent PostgreSQL sessions. The replacement preserves the existing `FOR UPDATE` locking mechanism.
