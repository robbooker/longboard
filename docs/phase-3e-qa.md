# Phase 3E — QA sweep

Written as the Commit 6 deliverable. Static audit results + the full
11-item acceptance checklist from the handoff, each marked with its
verification state. A handful are static-checkable; the rest need a
real browser + a real cron cycle to confirm.

## Static audit

### Auth gating — all correct

| Route | Gate | Verified |
|---|---|---|
| `GET /api/research/cached` | `requireUser` | ✓ handler line |
| `POST /api/research/refresh-prices` | `requireUser` | ✓ handler line |
| `GET /api/research/run-daily` | `Authorization: Bearer ${CRON_SECRET}` | ✓ handler line |
| `POST /api/research/run-daily` | `requireAdmin` | ✓ handler line |

`grep -n "requireUser\|requireAdmin\|CRON_SECRET" app/api/research/**/route.ts` returns exactly what the above table expects. No route falls through.

### Hardcoded colors

One intentional hex in `components/RankedResearchBlock.tsx`: `#d4af37` (TZ gold) as the rank-1 badge color. Commented inline as brand accent, not theme. Everything else flows through the Tailwind `terminal-*` namespace, which Phase 3B routed to unified CSS vars — both light and dark pick up correctly.

### Middleware

`/api/research/:path*` is **not** in the middleware matcher, intentional: the legacy `GET /api/research?ticker=X` (on-demand per-ticker pipeline) has always been unauthenticated and is still called by `ResearchPanel`'s localStorage cache path. Gating the parent prefix would break it. The three new sub-routes enforce their own auth at the handler level — same defensive shape, just no cross-cut layer. If `/api/research` is ever gated in a future cleanup, the middleware entry becomes safe to add.

### Build

- `npx tsc --noEmit` clean
- `npm run build` clean, all 31 static pages + 4 `/api/research/*` lambdas generated

## Handoff acceptance checklist (11 items)

1. **Audit document exists and answers all five open questions.**
   ✓ `docs/phase-3e-audit.md` landed in commit `459f1fa`. Post-rename addendum in commit `c6fa6f1`.

2. **`ticker_research` table created in Supabase with RLS on.**
   ✓ Migration `supabase/migrations/20260414_ticker_research.sql` applied; Rob confirmed `rank_position` column + partial index in place.

3. **Manually triggering `/api/research/run-daily` populates rows for every ticker on today's list.**
   ⚠️ Needs a live smoke test post-push. Static check: the POST handler is `requireAdmin`-gated and calls `runDaily(req.nextUrl.origin)` which hits `/api/gainers` → `/api/research?ticker=X` in parallel → Anthropic rank → upsert. Partial-failure is logged but doesn't abort. See `app/api/research/run-daily/route.ts`.

4. **Ticker page shows ranked research block below the list. #1 at top. Rank reason visible.**
   ✓ `components/RankedResearchBlock.tsx` renders cards sorted rank ascending, nulls last. #1 gets TZ-gold badge; others dim. `rank_reason` renders below the top row of each card. Mounted in `components/ResearchPanel.tsx` directly below the Top Gainers table.

5. **Page load time is dominated by the price refresh call, not the full research pipeline.**
   ✓ By design. `/api/research/cached` is a single Supabase SELECT (typically < 100ms). Price refresh fires concurrently from the client, pulling Polygon snapshot for all tickers in one batch (~500ms-1s). Full research pipeline (`/api/research/run-daily`) is only invoked by cron or the admin Run Now button, not on page load.

6. **Second page load within the same day is fast (cached, just a price refresh).**
   ✓ Same path as #5. Supabase reads the same row, prices refresh in parallel. No regeneration of the research payload.

7. **Cron (or Buddy) fires daily after market close and refreshes the cache.**
   ⚠️ `vercel.json` entry: `30 21 * * 1-5` = 21:30 UTC Mon-Fri = 17:30 EDT / 16:30 EST. After close year-round. Needs `CRON_SECRET` env var set in Vercel prod before the first fire — called out in commit `65bd302` message.

8. **Admin can manually trigger a refresh from the page.**
   ✓ Two Run Now paths in `RankedResearchBlock`: in the empty state (no rows for today, admin-only) and in the header when rows exist (also admin-only via the `me.role === "admin"` check). Both POST to `/api/research/run-daily`, reload cached data on success, surface errors inline.

9. **Non-admin users can view research but can't trigger refresh.**
   ✓ Non-admin users see the cards (via `requireUser`-gated cached route), see prices update (via `requireUser`-gated refresh-prices), do not see Run Now button (conditional on `me.role === "admin"`). Even if they forge a POST to `/api/research/run-daily`, `requireAdmin` returns 403 `admin_only`. Commit 5 added the Refresh Prices button for all users — they can ping the price refresh manually without admin.

10. **Empty state (no rows for today) renders gracefully, not a broken page.**
    ✓ Loading spinner → either rows (normal), or empty-state card with "No research run today yet" + admin-only Run Now button + explanatory text for non-admins, or `isFallback: true` banner + yesterday's rows, or an error strip if the cached route itself failed. Every state has an explicit render branch.

11. **Both themes look right.**
    ⚠️ Static analysis says yes — all colors route through `terminal-*` Tailwind classes (unified per Phase 3B) or one intentional brand hex. No `text-white` / `text-black` / rogue hex values. Needs a manual toggle at `/settings` to confirm contrast and spacing hold up in both modes.

## Items needing manual verification post-push

The three with ⚠️ above:

1. **Smoke-test manual Run Now.** Sign in as admin, click Run Now, wait ~15–20s, verify `rowsWritten` matches the gainers list length and cards populate. Check Supabase row count for today's `as_of_date`.

2. **CRON_SECRET + first cron fire.** Set `CRON_SECRET` in Vercel prod via `vercel env add CRON_SECRET production`, redeploy, wait for Mon–Fri 21:30 UTC, check Vercel function logs for the invocation + `ticker_research` for fresh rows without manual trigger.

3. **Light + dark walkthrough.** Toggle theme in the UserMenu, walk `/workspace`:
   - Ranked block header readable in both modes
   - Card borders visible against both backgrounds
   - Rank-1 gold (#d4af37) readable on both — it's a warm mid-tone, should work against both dark and light
   - Expandable research sections don't have washed-out key/value text in light mode
   - Warn-amber strips (fallback banner, partial-failure notice) have enough contrast
   - Run Now / Refresh Prices buttons readable in both

## Out-of-scope items deferred to future phases

- LLM-generated ranking reasons — done, was Option B in the audit.
- Historical research viewer — data is kept (`ticker_research` has no TTL on old rows), no UI yet.
- Per-user watchlists or custom filters.
- Alerts/notifications when a ticker hits rank #1.
- Editing the ticker list selection criteria.
- Paginating the research block — list stays at ~10 so paging unnecessary.

## Commits in this phase

| # | SHA | Summary |
|---|---|---|
| C1 | `459f1fa` | Audit doc only, no code |
| C2 | `4206000` | Migration + 3 API route skeletons + small-cap filter in `/api/gainers` |
| patch | `c6fa6f1` | `rank` → `rank_position` rename (Postgres reserved word) |
| C3 | `65bd302` | Full run-daily orchestration + `vercel.json` cron |
| C4 | `acd51df` | `RankedResearchBlock` UI component mounted in ResearchPanel |
| C5 | `20f67af` | Refresh Prices button + partial-failure expandable notice |
| C6 | *this commit* | QA doc only |

Seven commits total (six code + one doc), isolated for rollback.
