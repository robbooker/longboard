# Inbox history efficiency review

This local proposal replaces only `public.chat_activity_inbox(uuid,text[])`. It reduces repeated historical work while preserving the current payload, 50 mention/reaction previews, 100 DM previews, complete unread totals, cursor boundaries, and authorization. It is based on production commit `b02d01a515d723fcacadf61bcfe0a721da5424a3`. Nothing has been pushed or applied to production.

## Query changes

- `mentions AS NOT MATERIALIZED` lets the unread branch use the existing unread index while the preview branch stops after its newest 50 eligible rows. Authorization and block checks still precede the preview limit.
- Each authorized conversation computes its exact unread aggregate using its conversation/sequence bounds. A separate latest-incoming lookup supplies the preview, including read history and skipping outgoing/deleted messages. Counts and pinned unread values remain independent of the 100-preview cap.
- Room and DM reaction preview branches retain the current history helper's eligibility predicates and each take their newest 50 eligible rows before the combined top 50. No branch can contribute more than 50 to that final result. Unread reaction counts still use the existing unbounded unread helper.

No index, stored data, entitlement helper, public function signature, read mutation, client polling cadence, or member-count SQL changes. `STABLE`, `SECURITY INVOKER`, empty `search_path`, and existing execution grants are preserved. There is no cache or time-to-live that could delay block, entitlement, or expiry changes.

## Measured local results

PGlite's PostgreSQL engine, two warm-ups per function and seven alternating-order samples. Values are median wall-clock milliseconds for actual function calls.

| Fixture | Published query | Proposed query |
| --- | ---: | ---: |
| Empty inbox | 0.55 | 0.56 |
| One long thread, 20,000 DMs, 2,000 mentions and reactions each | 70.22 | 7.66 |
| 111 conversations, 42,000 DMs, mostly read history | 141.76 | 10.34 |
| Same history, all messages and notifications unread | 190.16 | 112.52 |

The many-thread read-heavy plan previously scanned 2,000 mentions, materialized 2,000 history reactions, and scanned the 42,000-row DM table twice. The proposed plan fetched five unread mentions plus 50 previews; approximately 335 unread DMs plus one latest message per conversation; and 50 room reaction previews, with no DM reaction targets in that sample. It used existing indexes. The one-thread case can still choose a sequential scan for its latest message; no planner setting is forced.

These are synthetic single-process measurements, not production latency, concurrency, or CPU estimates. Large unread backlogs still require counting all eligible unread events. Large runs of ineligible/deleted/outgoing entries can require scanning beyond a preview cap. Current production data distribution, statistics, query plans, and CPU relief are unverified. Ordering among identical DM timestamps remains unspecified, as in the published query.

Raw sample times and scan summaries are in `docs/evidence/chat-inbox-efficiency.json`. Re-running with `CHAT_INBOX_EVIDENCE_DIR=/tmp/longboard-inbox-evidence` also writes complete local plans.

## Verification

- 130 notification-history assertions, now including comparisons with the preserved published function: retained read entries, exact counters/maps/cursors, old-client cutoffs, live names/bodies, deletion, blocks in both directions, target ownership, nonparticipant reactors, pending/declined conversations, service-only access, strict ShortScout expiry, more than 50 notifications and 100 conversations, and pinned unread outside the preview sample.
- 49 additional long-history checks: full JSON parity, complete large unread counts, mixed room/DM reactions, over 50 ineligible newest entries, linked allow/deny/tier/expiry/revocation, direct-identity precedence, null/empty/duplicate room inputs, structural scan reduction, rollback, and reapply.
- Existing actual-app browser suite against synthetic SQL: desktop/mobile retained entries, error/retry, concurrent arrival versus read cutoffs, navigation, deletion, Quad visibility acknowledgements, unchanged feature notifications; zero browser runtime errors. Existing activity hook/coordinator race suite passed.
- Full 950 unit tests, 71 release-service tests, TypeScript and production build passed. Lint passed with zero errors and ten existing warnings. Browser coverage is Chromium emulation, not a physical-device or Safari claim.

Reproduce the SQL checks:

```sh
node scripts/tests/chat-notification-list-database.mjs
CHAT_INBOX_EVIDENCE_DIR=/tmp/longboard-inbox-evidence node scripts/tests/chat-inbox-efficiency-database.mjs
```

The existing `chat-notification-list-fixture.mjs` now loads the proposed migration. Its local app/fixture setup and browser commands remain documented in `chat-notification-list.md`. All fixture data and credentials are synthetic. No production diagnostics or state mutations were needed.

## Rollback and release review

Before any future release, review the migration and exact final commit through the established release workflow. This task does not authorize publication or a release-approval record. A production rollout would require checking supported PostgreSQL version, current function/index definitions and matching final hosted checks, then observing inbox latency/work and total database CPU after rollout.

Rollback restores only the `CREATE OR REPLACE FUNCTION public.chat_activity_inbox...` statement from `supabase/migrations/20261002152103_chat_notification_list.sql` (starting at line 35). Do not replay that entire migration: it also creates indexes and another function. Use a separately reviewed rollback migration through the normal publisher; no client rollback or data repair is needed. The local long-history suite executes that exact function restoration and reapplication and verifies identical results.

The bounded reaction projection duplicates the history helper's predicates inside the inbox to allow early limits. Future policy changes must update both projections together; the differential tests compare the optimized inbox with the previous inbox calling that helper so divergence is detected in the fixture.
