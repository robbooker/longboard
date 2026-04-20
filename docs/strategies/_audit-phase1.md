# Strategies Phase 1 — audit

**Date:** 2026-04-20
**Scope:** pre-Commit-2 audit per the handoff. Seven open questions + three pre-build items.
**Author:** Claude Code

Commit 1 deliverables (migration, strategy spec docs, seed) ship in the same commit as this audit per the handoff plan. Rob applies the migration manually in the Supabase SQL editor — this environment has no local Supabase shadow, so "migration applies cleanly" is verified by SQL-parse only, not by running it (see bottom for notes).

---

## Collision check — clear

No existing `/strategies` route, no `strat_*` tables, no `strategy_id` column anywhere in `supabase/migrations/`. Safe to proceed. Verified via Explore agent (direct `Glob`/`Grep` sweep of `app/strategies/**`, `supabase/migrations/*.sql`, TS queries for `.from("strat`).

---

## Q1 — Research pipeline entry point

The `/workspace` ranking pipeline is orchestrated in `app/api/research/run-daily/route.ts`. It works in three layers:

1. **Per-ticker brief assembly** (the drill-in target) — `GET /api/research?ticker=TICKER` returns a `ResearchBrief` (shape in `types/research.ts`). The route assembles market data + fundamentals + news + Exa results per ticker. `run-daily` invokes this internally via `fetch(new URL("/api/research?ticker=...", origin))` in `Promise.allSettled` across the gainers list — see `run-daily/route.ts:149-161`.

2. **Ranker** (not the drill-in target) — `rankWithAnthropic(briefs: ResearchBrief[]): Promise<Ranking[]>` in `run-daily/route.ts:52-115`. Single batch Anthropic call over all briefs. Returns `{ticker, rank, rank_reason}[]`. **Model:** `claude-sonnet-4-20250514` (Sonnet 4.0 May 2025) — see Q5.

3. **Cache** — `ticker_research` table (migration `20260414_ticker_research.sql`). Keyed on `(ticker, as_of_date)`. Contains `last_price` + `last_price_updated_at` from Polygon snapshot; filled by `/api/research/refresh-prices`.

**Commit 3 drill-in tool wraps the per-ticker path (layer 1).** Two implementation options:

- **A. Internal HTTP fetch** (matches `run-daily`'s existing pattern): drill-in tool handler calls `fetch(new URL("/api/research?ticker=X", origin))`. Zero refactor. Costs one extra Node round-trip per drill-in call.
- **B. Extract the brief-assembly logic to `lib/research-brief.ts`** and have both the existing `/api/research` route and the strategies module import it. Cleaner boundary. ~30 lines of moving code.

**Recommendation: B.** The morning routine runs from `npm run strategy:long-short:morning`, which is a pure-Node context with no request `origin` to pass. Option A requires invoking a running Next.js server, which won't exist in the cron context. Extraction is the right call.

## Q2 — Alpaca paper credentials — CONFLICT flagged

The handoff contains contradictory instructions:

- **Commit 1 intro** says: *"The new Alpaca paper account creds must load the same way (vault pattern, not env var hardcode)."*
- **Open Question 2** says: *"Rob will store them wherever the existing Polygon key lives; CC confirms that path and documents the env var or vault key names."* — Polygon lives in env var, not vault.

**Current state of the repo:**
- Polygon: env var `POLYGON_API_KEY` loaded directly in `lib/polygon-api.ts:2`, no helper wrapper needed.
- User-broker Alpaca (existing AutoTrade, account `PA35U6BCOIN6`): Supabase vault via `getAlpacaCredsForUser(userId)` at `lib/brokerKeys.ts:256`. Reads `user_broker_keys.vault_secret_id` then calls the `app_vault_read_secret(p_id)` RPC defined in migration `20260413_phase2a_vault_rpcs.sql`. Returns `{apiKey, apiSecret, baseUrl}`.

**Recommendation: vault pattern, consistent with the existing Alpaca loader.** Rationale:
1. The Commit 1 intro is explicit about vault-not-env-var; the Q2 open-question wording appears to be a slip.
2. The existing Alpaca cred path is already vault — using a different mechanism for the strategies-level account would split broker-cred handling into two patterns.
3. Trading authority (Alpaca) is higher-sensitivity than read-only market data (Polygon); vault gives rotation-without-redeploy.

**Proposed shape:**
- Extend `lib/brokerKeys.ts` with `getStrategyAlpacaCreds(strategyId: string): Promise<AlpacaCreds>` that reads from a new `strategy_broker_keys` table (one row per strategy, same shape as `user_broker_keys` minus the user scoping) — OR reuse `user_broker_keys` with a sentinel `user_id` (e.g. nil-uuid reserved for "strategy-owned").
- Rob stores the paper-account key + secret via the existing `app_vault_create_secret` RPC once, then inserts a row pointing to it.
- Schema decision (new table vs sentinel row) is a Commit 3 concern; the audit just flags the pattern.

**Needs Rob's confirmation before Commit 3.**

## Q3 — Slack helper — does not exist in Longboard

No Slack posting code anywhere in `/Users/claudebot/longboard`. `@slack/*` is not in `package.json`. The handoff assumed an existing helper.

**OpenClaw-side Slack** (Socket Mode, per scout-vault memory `9zPaWWVAxnkWkHWSYdakgT`) is a separate integration running in the `openclaw` user's context. The Strategies morning routine runs inside a `su - openclaw` shell invoking `npm run strategy:long-short:morning`, but that `npm` process is a Longboard Node subprocess — it can't directly talk to OpenClaw's Slack bridge without IPC.

**Recommendation: Slack Incoming Webhook + `fetch`.** No SDK dep, ~15 lines of code:

```ts
// lib/slack.ts
export async function postStrategiesSlack(text: string, opts?: { blocks?: unknown[] }) {
  const url = process.env.SLACK_STRATEGIES_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_STRATEGIES_WEBHOOK_URL not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(opts?.blocks ? { blocks: opts.blocks } : {}) }),
  });
  if (!res.ok) throw new Error(`Slack webhook ${res.status}`);
}
```

Rob creates the webhook URL in the Slack admin, points it at whichever channel he picks (default `#longboard-strategies`), stores the URL as `SLACK_STRATEGIES_WEBHOOK_URL` in `.env.local` + the OpenClaw env.

**Channel name:** no collision — nothing else in the repo references Slack channels. `#longboard-strategies` is available.

## Q4 — Economic calendar source + market-open helper

**Economic calendar:** no existing code, no existing API wired. Per handoff, defer to Phase 2 if unclear. **Decision: defer.** Phase 1 morning inputs are news + earnings + pre-market movers — the three we can source today without adding a vendor.

**Market-open / is-market-open helper:** also not present as a proper helper. Closest is `app/api/gainers/route.ts:22-37` with `isPreMarket()` + `isWeekend()` — no holiday awareness.

**Recommendation for Commit 5's holiday skip:** new helper `lib/marketCalendar.ts` with `isMarketOpenToday(): Promise<boolean>` that calls Polygon `/v1/marketstatus/now` (returns `{market, serverTime, exchanges, currencies}` — `market` is `open|closed|extended-hours`). Single network call, uses existing Polygon key. Caches nothing (called once per morning run). Fallback on API failure: use a small hardcoded 2026 US market holiday array so the cron never mis-fires on Thanksgiving.

## Q5 — Claude model for research-grade tasks

**Repo default today:** `claude-sonnet-4-20250514` — used in both existing Anthropic callers:
- `app/api/research/run-daily/route.ts:82` (ranking)
- `app/api/analyze/route.ts:71` (stock analysis)

**Integration style:** raw HTTP to `https://api.anthropic.com/v1/messages`, not the Anthropic SDK — despite `@anthropic-ai/sdk@^0.90.0` being in `devDependencies`. The SDK is unused. Both routes hand-roll the request body.

**Flag:** `claude-sonnet-4-20250514` is older than the current Claude 4.6/4.7 family. Updating the model string affects existing callers too, so it's a cross-cutting task best done separately. **Recommendation for Phase 1: use the repo default (`claude-sonnet-4-20250514`) for continuity.** The morning routine calls out the model choice in code, so swapping later is a one-line edit. If Rob wants to upgrade on this phase, that's a trivial preamble commit to align everything at once — let me know.

## Q6 — Forbidden tickers list

No existing list. Creating one in `lib/strategies/forbidden-tickers.ts`. Proposed Phase 1 seed (handoff list + Direxion/ProShares leveraged + inverse universe I'd add):

```
// 3x bull / 3x bear broad index
TQQQ, SQQQ, UPRO, SPXU, TNA, TZA

// Semiconductor 3x
SOXL, SOXS

// Volatility products (short-term futures-based)
UVXY, SVXY, UVIX, SVIX, VXX, VIXY

// Inverse broad index (1x/2x)
SH, SDS, QID, PSQ, DOG, DXD

// Leveraged + inverse sector
LABU, LABD, CURE, FAS, FAZ, ERX, ERY, GUSH, DRIP, NAIL, WEBL, YINN, YANG,
EDC, EDZ, DRN, DRV, BULZ, BERZ, RETL

// Leveraged bonds / metals
TMF, TMV, NUGT, DUST, JNUG, JDST, AGQ, ZSL, UGL, GLL, UCO, SCO, BOIL, KOLD
```

**Rule for "which funds count as leveraged/inverse":** if a ProShares / Direxion / MicroSectors product's stated objective is any multiple of an index (positive or negative), it's on the list. File exports a `const FORBIDDEN_TICKERS: Set<string>`. Server-side constraint check in Commit 3 rejects the order if `FORBIDDEN_TICKERS.has(ticker)`.

Rob extends as needed — list lives in one file, one line each.

## Q7 — Ticker price source for sizing

**Existing pattern** (Phase 3E refresh-prices, `app/api/research/refresh-prices/route.ts:76-86`): Polygon `/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` → `lastTrade?.p ?? day?.c ?? prevDay?.c`.

**For Commit 3 sizing:** call Polygon single-ticker snapshot at the moment of the order decision, via a new helper `getLastTradePrice(ticker): Promise<number>` wrapping `polygonFetch`. Same fallback chain. Use `lastTrade.p` in pre-market (not always `day.c`, which is zero pre-market).

**Recommendation confirmed: Polygon.** Alpaca has last-quote endpoints too, but Polygon is already the vendor of record, already keyed, and the existing refresh-prices logic is battle-tested against pre-market edge cases.

---

## Additional findings

### "How it works" modal — markdown renderer

The handoff references "the repo's existing markdown renderer (the one `/issues` uses)". **`/issues` does not exist in this codebase.** Nearest analog: `/learn/[slug]` uses `next-mdx-remote/rsc` with `<MDXRemote source={body} components={essayMdxComponents} />`. `next-mdx-remote` v6.0.0 is in `dependencies`.

**Recommendation for Commit 2's modal:** reuse `next-mdx-remote/rsc`. Strategy spec docs are plain markdown (headings, lists, prose) — MDX parses MD cleanly. Component map can be minimal (or empty) since the spec doesn't need `<Pullquote>`-style chrome. The modal is a client component, so we'd load the rendered MDX from a server component via a data prop (or move the modal to read the MDX at render time via a server action).

### Anthropic SDK vs raw HTTP

`@anthropic-ai/sdk@^0.90.0` is a devDep but never imported. The two existing callers use raw `fetch`. Phase 1 matches that pattern — fewer moving parts, no opinion on whether to adopt the SDK.

### Schema audit — migration pattern

Existing migrations use `create table if not exists`, `create index if not exists`, `drop policy if exists` before `create policy`, and enable RLS explicitly. My Phase 1 migration follows the same conventions. No RLS policy on `strategies` / `strat_*` tables — writes are service-role only (from the morning routine), reads for `/strategies` page go through a service-role-backed API route (same pattern as `/api/admin/audit`). If the `/strategies` page ever needs to be readable by non-admin users, we add `"authenticated read"` like on `essays`.

### "Local Supabase shadow" — workflow note

There is no local Supabase instance in this environment and no Supabase CLI config in the repo. Existing migrations are applied manually via the Supabase SQL editor (convention noted in prior phase handoffs — e.g. Phase 3L). For this phase, Commit 1's acceptance criterion "migration applies cleanly" is verified by:

1. SQL parse-check via `psql --dry-run` not available either — fallback: careful review.
2. Review of the file for postgres-compatibility (no SQLite-isms, correct `jsonb`/`uuid` usage, matching existing migration conventions).
3. Rob applies via SQL editor and reports back.

Flagging this so the acceptance bar is clear: CC ships the SQL file; Rob applies and confirms the three seed rows land.

---

## Summary — Rob's action items before Commit 3

Three calls from Rob unblock Commit 3:

1. **Addendum Q2:** confirm vault pattern (recommended) vs env var for strategies-level Alpaca paper creds. If vault: should I add a `strategy_broker_keys` table or reuse `user_broker_keys` with a sentinel user? If env var: say so and I'll use `STRATEGY_ALPACA_PAPER_KEY_ID` + `STRATEGY_ALPACA_PAPER_SECRET`.
2. **Addendum Q3:** create the Slack Incoming Webhook for `#longboard-strategies`, drop the URL as `SLACK_STRATEGIES_WEBHOOK_URL` in `.env.local` + OpenClaw env. Reply "webhook ready" when done.
3. **Addendum Q5:** keep Phase 1 on `claude-sonnet-4-20250514` (recommended) or upgrade repo-wide to `claude-sonnet-4-6` as a preamble task?

Zero of these block Commit 1 (migration + specs ship now). They're prerequisites for Commit 3.

---

## What Commit 1 ships

- `supabase/migrations/20260420_strategies_phase1.sql` — 4 tables, 3 indices, 3-row seed, RLS on.
- `docs/strategies/long-short.md` — canonical spec, verbatim from §Strategy spec in the handoff.
- `docs/strategies/black-swan.md` — mandate + "planned" stub.
- `docs/strategies/covered-caller.md` — mandate + "planned" stub.
- `docs/strategies/_audit-phase1.md` — this file.
