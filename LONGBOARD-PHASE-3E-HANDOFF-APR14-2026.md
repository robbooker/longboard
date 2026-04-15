# Longboard — Phase 3E Handoff: Cached Research + Ranked Picks

**Date:** April 14, 2026
**Prerequisite:** Phase 3D shipped and verified in prod.
**Working dir:** `/Users/claudebot/longboard`
**Branch:** `main`
**Live URL:** https://longboard-ruddy.vercel.app

---

## Goal

The ticker list page (likely `/workspace` or `/surf` — CC to confirm) shows a filtered list of small-cap stocks today. This phase adds a ranked research block below the list:

- Each ticker on the list gets a full research run (uses existing Polygon + Brave + SEC EDGAR + Exa + Perplexity pipeline).
- Results are ranked — #1 stock at the top with an explicit reason it's ranked first.
- Research is cached in Supabase. Page loads serve cached research instantly.
- Only **current price** refreshes on every page load. Everything else is cached.
- Cache invalidates at **end of day** (daily refresh — 4pm ET or later).

---

## Decisions locked (from Rob)

- Ticker list logic **already exists** in codebase. Small-cap filter (somewhere in the $20M–$100M market-cap range), excludes ETFs / SPACs / warrants. CC must read the existing filter code before building — don't re-spec the selection criteria.
- Research pipeline **already exists** in codebase via the existing APIs (Polygon, Brave, SEC EDGAR, Exa, Perplexity). Don't build a new research engine. Wire the existing one to run per-ticker and store results.
- Cache invalidation: **end of day**. Daily refresh, not time-windowed or event-based.
- Page: **Rob said it doesn't matter** which page (`/workspace` or `/surf`). CC: pick whichever currently renders the ticker list. Document the choice.

---

## Open questions for CC to resolve (answer in the audit phase, before writing code)

Before Commit 1, CC must produce a brief audit document (`docs/phase-3e-audit.md`) answering:

1. **Which page renders the ticker list today?** `/workspace`, `/surf`, or somewhere else? Confirm the file path.
2. **What is the exact market-cap filter?** Read the filter code and state the numeric threshold(s) + any other exclusion rules (ETF/SPAC/warrant detection — how is it currently detected?).
3. **Where is the research pipeline?** File path(s). What's its interface — does it take a single ticker and return a structured result, or is it orchestrated differently?
4. **How many tickers does the list typically produce on a given day?** (Rough count — 10? 50? 500?) This affects whether the daily run can hit all tickers synchronously in one API route or needs background processing.
5. **Does Buddy (the OpenClaw server at `45.55.64.14`) currently push research data into the app, or is all research generated on-demand from Next.js API routes?** Affects whether the daily refresh runs on Buddy's side or inside Vercel.

Rob reviews the audit. CC waits for go-ahead before Commit 2.

---

## Data model

**New Supabase table:** `ticker_research`

```sql
create table ticker_research (
  ticker text not null,
  as_of_date date not null,
  rank integer,
  rank_reason text,
  research jsonb not null,          -- full structured research output
  last_price numeric,                -- most recent price snapshot (refreshed separately)
  last_price_updated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (ticker, as_of_date)
);

create index ticker_research_rank_idx on ticker_research(as_of_date, rank) where rank is not null;

alter table ticker_research enable row level security;

-- No public access. Reads + writes go through API routes using service role.
```

Singleton pattern per ticker per trading day. Historical rows kept (don't delete yesterday's row) — valuable for post-hoc analysis and potential Phase 4 "look back" features.

**Separate concern — current price refresh:**
- On page load, read cached research for today's date.
- For each ticker, fire a lightweight Polygon call for current price.
- Update `last_price` + `last_price_updated_at` in the row.
- Display research from cache, price from fresh fetch.

---

## Ranking + reasoning

This is the one genuinely new piece of logic. Two approaches — CC should propose one in the audit, Rob picks:

**Option A: Rule-based ranking**
- Score each ticker on explicit metrics from the research output (e.g. catalyst recency, SEC filing density, volume spike magnitude, analyst mention count).
- Rank by composite score.
- `rank_reason` is a templated string: "Ranked #1: strongest catalyst in past 7 days (8-K filing Apr 13), volume 4x average."
- Deterministic, cheap, debuggable.

**Option B: LLM-generated ranking**
- Feed the full research output for all tickers to an LLM (Anthropic or similar).
- Ask for ranking + natural-language reason per ticker.
- `rank_reason` is the LLM's generated explanation.
- More flexible, produces better-reading reasons, but adds cost per daily run and introduces non-determinism.

**Rob's default preference:** not stated. CC: propose Option A unless there's a clear reason it won't work with the existing research output shape. LLM-based ranking can be a Phase 3F upgrade if Option A feels too rigid.

---

## Build plan — 6 commits, isolated for rollback

### Commit 1 — Audit document

CC writes `docs/phase-3e-audit.md` answering the five open questions above. Proposes ranking approach (A or B). Commits the doc. No code changes.

**Acceptance:** Rob reads, gives go-ahead.

### Commit 2 — Supabase migration + API routes

- New migration: `supabase/migrations/20260414_ticker_research.sql` with the schema above.
- New API route: `GET /api/research/cached` — returns today's cached research for all tickers in rank order, auth-gated (user, not admin).
- New API route: `POST /api/research/refresh-prices` — takes a list of tickers, fires Polygon for each, updates `last_price` rows, returns fresh prices. Auth-gated.
- New API route: `POST /api/research/run-daily` — orchestrates the daily research run. Auth-gated + admin-only (so it's not accidentally triggered). For v1, this is a manual trigger; automation comes in a later commit.

Apply migration in Supabase SQL editor. Verify table exists.

### Commit 3 — Daily research job

Depends on audit answer to question 5 (Buddy vs Vercel):

**If Buddy-orchestrated:** CC writes a Buddy script that calls `/api/research/run-daily` (or writes directly to Supabase via service role) once a day after market close. Script lives on OpenClaw alongside existing Buddy jobs.

**If Vercel-orchestrated:** use Vercel Cron (defined in `vercel.json`) to hit `/api/research/run-daily` once a day at 4:30pm ET (after close).

The `run-daily` handler:
1. Fetches today's ticker list (call existing filter code).
2. For each ticker, runs existing research pipeline.
3. Ranks results (per audit decision).
4. Writes one row per ticker into `ticker_research` with `as_of_date = today`.
5. Returns count of rows written + any errors.

Include idempotency — if run twice in a day, second run updates existing rows rather than erroring on PK conflict.

### Commit 4 — UI: ranked research block on the ticker page

- Below the existing ticker list, render a new section: "Today's Ranked Research" (or whatever heading fits the page's voice).
- On mount, `GET /api/research/cached` → display cards in rank order.
- Each card: ticker, rank badge (#1 in gold, others muted), rank reason, current price (placeholder until prices load), full research output (collapsible — default collapsed to keep the page scannable).
- Second fetch: `POST /api/research/refresh-prices` with the ticker list → update price fields in place as responses arrive.
- If no research exists for today (empty table): show "No research run today yet" + (admin only) a "Run Now" button that hits `/api/research/run-daily`.
- Use existing CSS vars — tracks light/dark.

### Commit 5 — Empty state + error handling

- Handle the case where `ticker_research` has no rows for today (first deploy, cron hasn't run, etc.).
- Handle partial failures (some tickers succeeded, others didn't — show what exists, note errors).
- Handle stale cache gracefully if cron misses a day (e.g. show yesterday's data with a "last updated: [date]" banner rather than blank).
- Add a "refresh prices" button on the page for manual re-trigger.

### Commit 6 — QA + cleanup

- Walk the page in both themes.
- Confirm the daily job writes rows correctly (smoke test by manually triggering `run-daily` as admin).
- Confirm price-only refresh works and is noticeably faster than full research run.
- Verify auth gating on all three new API routes.
- `tsc` clean.

---

## Files expected to change

**New:**
- `docs/phase-3e-audit.md` (commit 1)
- `supabase/migrations/20260414_ticker_research.sql`
- `app/api/research/cached/route.ts`
- `app/api/research/refresh-prices/route.ts`
- `app/api/research/run-daily/route.ts`
- `vercel.json` or Buddy cron script (depending on audit answer)
- New component for the ranked research block (location depends on which page)

**Modified:**
- Whichever page renders the ticker list (`/workspace` or `/surf`) — add the ranked research block below the list

---

## Acceptance criteria

1. Audit document exists and answers all five open questions.
2. `ticker_research` table created in Supabase with RLS on.
3. Manually triggering `/api/research/run-daily` populates rows for every ticker on today's list.
4. Ticker page shows ranked research block below the list. #1 at top. Rank reason visible.
5. Page load time is dominated by the price refresh call, not the full research pipeline.
6. Second page load within the same day is fast (cached, just a price refresh).
7. Cron (or Buddy) fires daily after market close and refreshes the cache.
8. Admin can manually trigger a refresh from the page.
9. Non-admin users can view research but can't trigger refresh.
10. Empty state (no rows for today) renders gracefully, not a broken page.
11. Both themes look right.

---

## Out of scope for 3E

- LLM-generated ranking reasons (Phase 3F if Option A feels rigid).
- Historical research viewer ("show me yesterday's research") — data is kept, just no UI yet.
- Per-user watchlists or custom filters.
- Alerts/notifications when a ticker hits rank #1.
- Editing the ticker list selection criteria.
- Paginating the research block (assumes list size stays manageable; if audit shows 500+ tickers, revisit).

---

## Working conventions (carried forward)
- One step at a time, explicit commands
- Each commit isolated for easy rollback
- Single-line TS generics only
- Commits stay local; Rob pushes manually via `git push origin main` from claudebot
- Don't hypothesize — give symptom + diagnostic data
- **Commit 1 (audit) blocks on Rob's review before Commit 2 starts**

---

*Save to Longboard project. New chat + this doc + "let's build Phase 3E" is enough to pick up cleanly.*
