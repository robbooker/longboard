# Longboard Morning Report Automation V1

Date: May 7, 2026
Status: finalized product/build spec for v1

This document supersedes the earlier planning note at `docs/morning-report-automation-plan.md` where the two disagree.

## Product Spec

### Core Model

The morning report is a living report of record for the trading day. Command Center reads the current report. Email HTML is prepared from the same report. Email sending is not part of v1.

V1 keeps the backend name `morning_email_archive`. The product noun is "report", but the existing table name can remain an implementation detail for now.

There is exactly one current report of record per Eastern Time market date.

### Report Lifecycle

- A heavy morning build runs at 6:30am ET on scheduled weekdays.
- Lightweight live refreshes run every 15 minutes from 7:00am ET through and including 4:00pm ET.
- Early closes and market holidays are ignored in v1.
- Before today's report exists, members see the scheduled issue time and a live countdown; the previous day's report is hidden at midnight ET.
- On Saturday and Sunday, when no same-day manual report exists, Command Center shows a recap calculated from the latest saved report version for each weekday, plus the countdown to Monday's first issue.
- If a morning build or manual full regeneration is in progress before today's report exists, members keep seeing the waiting/countdown state. If a same-day report already exists, it remains visible.
- If a heavy build fails before today's report exists, members keep seeing the waiting/due-now state and admin sees the failure.
- Once a new report version succeeds, it becomes current automatically.

### Expensive vs Cheap Work

The heavy build generates the full report:

- picks and ranking
- per-ticker research and commentary
- price targets and levels
- top-of-report narrative/framing
- render-ready payload
- prepared email HTML

The live refresh updates only the selected tickers in the current report:

- current price
- percent change
- dollar change
- volume
- relative volume if cheaply available
- market cap
- last quote/trade timestamp
- `prices_updated_at`
- prepared email HTML

Live refresh must not call Claude, Perplexity, OpenAI, or any other expensive research/narrative generation path.

Expensive generation cache validity for v1 is `report_date + ticker + content_type`. Store model/source metadata for visibility, but do not use it for cache invalidation yet.

### History

Every successful report state is saved forever. That includes successful full builds, manual full regenerations, partial live refreshes, full live refreshes, and the 4:00pm closing refresh.

Each saved version stores the entire render-ready payload, including prepared email HTML. Each payload includes a `report_schema_version`.

The current report is resolved by a latest successful report row plus an explicit current pointer/flag. The current pointer moves only after a successful or partial-success version is saved.

Saved versions have a version label:

- `morning_build`
- `manual_full_regeneration`
- `live_refresh`
- `closing_refresh`

V1 does not need an admin historical browser. Saving the versions is enough.

### Failure And Recovery

Any scheduled or manual job can run twice without corrupting state.

Duplicate jobs are ignored or coalesced while one of that job type is already running. Full build/regeneration takes priority over live refresh.

If a scheduled live refresh starts while a full regeneration is running, skip or queue the live refresh. After the full regeneration succeeds, run a price refresh immediately.

Live refresh starts from the current report payload and patches in updated market data. This preserves expensive content and previous good ticker values.

Save rules:

- Failed full build/regeneration: no report version saved.
- Failed live refresh with zero ticker updates: no report version saved.
- Partial live refresh with at least one successful ticker update: save a new full-payload report version and make it current.
- Full live refresh success: save a new full-payload report version and make it current.

Partial live refresh is allowed. Successful tickers update; failed tickers keep their last good values; failed tickers are recorded in job metadata.

### Member-Facing Command Center

Command Center reads the current report API.

The API returns:

- full report payload
- `version_id`
- `report_date`
- `prices_updated_at`
- `generated_at`
- `version_type`
- other lightweight metadata needed for polling/display

Command Center auto-polls every 5 minutes while open. If polling finds a newer version, the page updates in place automatically.

Members see a subtle freshness timestamp based on successful job completion time, for example: "Prices updated 11:15 AM ET".

On weekends, the empty board becomes "Week on the Board": reporting days, total board appearances, unique tickers, the top runner, and a day-by-day ticker strip. Intraday refresh versions count once because the recap uses only the newest completed version for each report date. A same-day manual report still takes precedence over the recap.

Members do not see per-ticker stale indicators in v1. Admin tracks per-ticker failures and provider timestamps.

### Admin V1

V1 admin actions reuse the existing admin/auth protection used by `/admin/morning-email`.

Controls:

- Refresh live prices now
- Regenerate full report
- View refresh/build status
- Retry live refresh
- Retry morning/full build

No manual editing/override in v1.

No email sending in v1.

No confirmation dialog for "Regenerate full report".

The existing admin generate button becomes "Regenerate full report" and shares the same core backend job as the scheduled 6:30am build, with trigger metadata distinguishing scheduled, admin, and retry.

Admin status auto-polls roughly every 15-30 seconds while open.

Failure visibility is admin-only in v1. No Slack or email notifications.

Admin warning states:

- morning build failed
- today's expensive report content is missing
- live data is more than 30 minutes stale during the 7:00am-4:00pm ET operating window
- a ticker fails refresh twice in a row

### Job Metadata

Store one row per job run with:

- job type: `morning_build`, `manual_full_regeneration`, `live_refresh`
- trigger: `scheduled`, `admin`, `retry`
- status: `running`, `success`, `failed`, `skipped`
- started/completed timestamps
- duration
- affected ET report date
- tickers attempted/succeeded/failed
- error summary/details
- whether current report was updated
- whether email HTML was regenerated
- expensive API usage metadata if available

### Time Semantics

All report schedules and member-facing market timestamps use Eastern Time.

`report_date` is the Eastern Time market date.

Technical timestamps such as `created_at`, `started_at`, and `completed_at` can be stored in UTC.

## Implementation Plan

### Existing Surfaces

Relevant current files:

- `supabase/migrations/20260429_morning_email_archive.sql`
- `app/admin/morning-email/MorningEmailClient.tsx`
- `app/api/admin/morning-email/scan/route.ts`
- `app/api/admin/morning-email/research/route.ts`
- `app/api/admin/morning-email/generate-targets/route.ts`
- `app/api/admin/morning-email/generate/route.ts`
- `app/api/command2/snapshot/route.ts`
- `app/command2/page.tsx`
- `components/command2/CommandCenterV2.tsx`
- `lib/morningArchive.ts`
- `lib/morning-email/polygon.ts`
- `lib/morning-email/render-email.ts`
- `lib/morning-email/types.ts`
- `vercel.json`

The current system already snapshots successful manual generation into `morning_email_archive` and `/command2` reads the latest row dynamically.

### Phase 1: Schema

Add a migration that extends, rather than renames, the current archive model.

Recommended additions to `morning_email_archive`:

- `report_date date`
- `report_schema_version integer not null default 1`
- `version_type text not null default 'manual_full_regeneration'`
- `status text not null default 'success'`
- `is_current boolean not null default false`
- `current_pointer_key text`
- `payload_json jsonb`
- `prices_updated_at timestamptz`
- `generated_at timestamptz`
- `trigger text`
- `job_run_id uuid`

Keep existing columns for compatibility:

- `sent_date`
- `subject`
- `stocks_json`
- `qa_json`
- `html`
- `generated_by`
- `generated_by_email`
- `created_at`

Add supporting tables:

- `morning_report_job_runs`
- `morning_report_locks` or a Postgres advisory-lock helper
- optional `morning_report_research_cache` for `report_date + ticker + content_type`

Indexes:

- current report lookup by `is_current`, `report_date`, `created_at`
- history lookup by `report_date`, `created_at`
- job run lookup by `job_type`, `status`, `started_at`
- research cache unique index on `report_date, ticker, content_type`

Because these tables live in `public`, keep RLS enabled. Access should continue through service-role API routes unless and until a narrower policy is intentionally designed.

### Phase 2: Core Report Service

Create a server-only service module, for example `lib/morning-report/service.ts`, that owns the lifecycle.

Core functions:

- `runFullReportBuild({ trigger })`
- `runLiveRefresh({ trigger })`
- `getCurrentReport()`
- `saveReportVersion({ payload, html, versionType, jobRunId, metadata })`
- `setCurrentReportVersion(versionId, reportDate)`
- `withReportJobLock(jobType, fn)`
- `recordJobRunStart/Success/Failure/Skipped`

The full build should wrap the existing manual steps:

1. scan existing source universe using the current scan flow
2. research/enrich selected stocks
3. generate price targets
4. render HTML
5. run QA
6. save full report version
7. set current pointer

The manual admin path and scheduled 6:30am path should both call this same service.

### Phase 3: Live Refresh Service

Add a cheap refresh path that:

1. loads the current report
2. extracts selected tickers
3. fetches market data/reference data for those tickers only
4. patches current price, percent change, dollar change, volume, relative volume if available, market cap, and provider timestamp
5. regenerates email HTML from the patched payload
6. saves a new full-payload version if at least one ticker updated
7. advances `is_current`

This service should reuse Polygon helpers where possible, but should expose a ticker refresh helper that returns success/failure per ticker instead of throwing wholesale.

### Phase 4: API Routes

Replace or wrap existing routes with job-oriented endpoints.

Admin:

- `POST /api/admin/morning-report/regenerate`
- `POST /api/admin/morning-report/refresh-prices`
- `POST /api/admin/morning-report/retry-build`
- `POST /api/admin/morning-report/retry-refresh`
- `GET /api/admin/morning-report/status`

Cron:

- `GET /api/cron/morning-report-build`
- `GET /api/cron/morning-report-refresh`
- `GET /api/cron/morning-report-tick` for the production Vercel schedule; it dispatches to build or refresh based on ET time.

Command Center:

- Keep `/api/command2/snapshot`, but change it to return the new current report contract.

Cron routes should verify a secret and then call the shared service. Admin routes should use `requireAdmin`.

### Phase 5: Scheduling

Vercel cron schedules are UTC, so encode ET times carefully.

For May operating time, the intended ET schedule maps to:

- 6:30am ET heavy build: `30 10 * * 1-5` during daylight time
- 7:00am-4:00pm ET live refreshes: every 15 minutes from `11:00` through `20:00` UTC during daylight time

Because Vercel cron is UTC and cron-count limits can matter, use a single `/api/cron/morning-report-tick` schedule that fires every 15 minutes across the broad UTC range needed for Eastern Time. The route checks ET time internally: it builds at 6:30am ET, refreshes from 7:00am through 4:00pm ET, and returns `skipped` outside the operating window.

V1 can ignore holidays and early closes.

### Phase 6: Admin UI

Update `/admin/morning-email` rather than creating a new surface unless the existing page becomes too crowded.

Add:

- current report status card
- last build status
- last live refresh status
- stale warning state
- failed ticker summary
- "Refresh live prices now"
- "Regenerate full report"
- "Retry live refresh"
- "Retry morning/full build"
- prepared email HTML copy/download if still useful

Remove or de-emphasize manual edit workflow for v1, since manual editing is explicitly out of scope.

### Phase 7: Command Center

Update `components/command2/CommandCenterV2.tsx` to:

- poll every 5 minutes instead of 60 seconds
- compare `version_id` before replacing state
- display "Prices updated ..." from `prices_updated_at`
- continue showing the current in-memory snapshot if polling fails

Keep `app/command2/page.tsx` dynamic so first page load reads current server state.

### Phase 8: Tests

Automated tests should focus on backend lifecycle safety:

- failed full build leaves previous current report in place
- failed live refresh with zero updates creates no version
- partial live refresh preserves failed ticker values and advances current pointer
- duplicate job lock prevents concurrent corruption
- live refresh does not call expensive research/AI generation
- current report API returns metadata suitable for polling
- prepared email HTML regenerates after live refresh

Manual QA should verify:

- Command Center hides prior-day reports after midnight ET and shows the 6:30am ET waiting/countdown state until a same-day scheduled or manual report succeeds
- member-facing freshness timestamp is ET and based on job completion
- admin status/warnings reflect job logs

## Deferred

- table rename away from `morning_email_archive`
- official NYSE calendar and early-close behavior
- Slack/email failure notifications
- manual copy editing/override
- regenerate narrative-only action
- email sending
- admin historical report browser
- retention cleanup
