# Archive Ticket Ordering

Ticket `d4334a94-8186-43fb-8716-add32885ddaa`, approved revision 2. Published base `d67d43dcc485f0f999462c1b4d4d92a908706e25`.

Archive uses completion dates globally, newest first by default. **Newest first / Oldest first** changes the direction immediately, resets pagination to page one and retains the current title filter and selected ticket/thread. Search retains the direction. The selected ticket can be outside the filtered page and its discussion draft is preserved while sorting. Active tickets retain their existing priority order and controls.

## Authoritative date contract

The additive `chat_feature_request_list` view is read-only and `security_invoker`. It exposes explicit existing feature-list fields, the existing bounded release summary, and `archive_order_at`. It does not expose worker tokens, approval identities or account IDs. Only `service_role` can SELECT it; the API retains the private `featureAccess` gate. Browser database roles cannot read or mutate it.

Dates follow this precedence:

1. A `done` request with a `published` release uses that release's `updated_at`. The existing guarded publication function writes this timestamp and `status=done` together; its normal terminal-state guards prevent subsequent release updates.
2. A manually `archived` request uses its recorded `archived_at`, labeled **Archived** rather than completed.
3. A legacy `done` request without a published release uses the earliest exact database-generated completion notification: `category='status'`, `event_key LIKE 'status:%'`, and `label='Published and verified'`. This is independent of recipient and read state. It also handles an anomalous nonpublished release record only when that exact completion evidence exists.
4. Missing evidence stays null and is labeled unavailable. Ticket creation, claim/approval dates, discussion text, system-message prose, and migration time are never substituted.

The coordinator's read-only production evidence found 106 done requests: 99 with published releases and seven legacy requests with those structured events. This migration performs no historical writes or backfill. Completion events can be absent due to existing notification preferences/mutes; unknown dates remain supported.

The query materializes only legacy candidate IDs and aggregates matching status notifications once. Local `EXPLAIN ANALYZE` verifies one notification-table scan, avoiding a scan per ticket without adding an index or background job. This is local PGlite evidence, not a measured production query plan or latency claim. Normal status-only polling reads base `id,status` fields and does not run the archive aggregate.

## Ordering and navigation

The server applies date ascending/descending, **NULLS LAST in both directions**, then stable UUID ascending before the existing 50-row page plus one lookahead row. Equal dates never depend on priority or result arrival order. The same literal escaped title filter applies before pagination. Active ordering remains priority ascending, newest priority assignment first, creation time, then UUID.

Direction, title filter, page and selection are represented in the URL. Native `history.replaceState` retains Next's history state while updating the URL synchronously, so immediate reload retains the chosen order. Back/Forward reconciles the current URL. No persistent cross-account preference or new polling stream is introduced. Existing full-list and lightweight status reconciliation intervals remain unchanged.

Full reads are fenced by selection, view, query, page, direction and generation, including error paths. Obsolete status-only responses cannot change the new list's selected status. Changing search/view/order invalidates outstanding intent immediately. A canonical deep link still resolves its selected request independently of the page; when an old active link resolves to Archive, the view/page is normalized without losing its selected history.

## Validation

- Database suite: **40 assertions** using actual migrations. It covers 120 published rows, seven legacy event pairs, manual dates, unknown and nonpublished-release edges, deterministic ties, complete three-page traversals in both directions, filtering, private roles, safe release fields, SELECT-only access, identical publisher/archive/priority function definitions, and unchanged request/release/notification records after reads.
- Feature API route suite: **22 tests**, including private access, direction validation/default, escaped search, sorting before pagination, active priority order, out-of-page selected links, and the base-table status-only projection.
- Existing feature, archive, priority, release, notification, Jammie approval and approved-edit database suites pass unchanged. The release suite passes **41** checks; notification suite **36**; feature suite **22**. Existing release-service safeguards pass **71 tests**.
- Full unit suite: **892 tests in 110 files**. TypeScript and the production Next build pass. ESLint has **zero errors and ten existing unrelated warnings**. Final type checking runs after the build to avoid generated `.next/types` churn.

The actual-app browser harness passes against the production build on **3359/54559** with synthetic users and current SQL, separately in installed Chromium and Google Chrome (both report **Chrome/152.0.7977.82**). Both runs finish with zero browser errors. They verify global pages, both directions, legacy/null dates, search and URL retention, immediate reload, selected history/drafts, rapid search/tab changes, native Back/Forward, desktop and 320px touch controls, existing polling, owner priority/manual archive behavior, participant restrictions and anonymous denial. Viewport-only and full-page screenshots are saved under `/tmp/chat-archive-order-*`; final logs are `/tmp/chat-archive-order-production-chromium.log` and `/tmp/chat-archive-order-production-chrome.log`.

The held full-response cases explicitly deliver an obsolete success and error after the newer result and verify the list and error state remain current. The held status-only case verifies the old result cannot change selected status; effect cleanup may cancel that request, so it is not claimed as a delivered stale status response. An earlier test attempt stalled waiting for global network idle on the polling page. The final harness waits for the exact held response with a five-second timeout and then checks the UI; pending held responses are released on failure cleanup. These were harness synchronization changes, with no runtime change. Independent review passed all 22 API tests and 40 database assertions, and reviewed both final production logs, screenshots, migration digest, and synchronization/cleanup changes.

PGlite executes sequentially; no native multi-session PostgreSQL contention coverage is claimed. The view is read-only and introduces no locking or mutation path. Browser emulation is not a physical-device test. Installed Google Chrome and Chromium share the Chromium engine family; this does not claim Firefox or Safari coverage.

## Release compatibility

The migration adds only the SELECT projection. Existing tables, functions, workflow transitions, approval/archive/release guards, jobs, timers and publishing infrastructure are unchanged. Existing deployed clients continue to use their original reads; omitted direction defaults to descending on the new API. The dedicated release service applies the additive migration before the new app is activated.

The exact migration digest is in `.release/d4334a94-8186-43fb-8716-add32885ddaa.json` with `backwardCompatible: true`. The worker only implements, tests and commits locally. The coordinator retains hosted checks, exact-version registration and authorization, release-service dispatch and live verification.
