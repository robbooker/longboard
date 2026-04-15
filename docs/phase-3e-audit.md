# Phase 3E — Audit

**Status:** pre-implementation audit. Commit 1 of the Phase 3E plan. No code changes in this commit.
**Date:** 2026-04-14
**Author:** CC

Two decisions locked upstream:
- **Ranking approach:** Option B, LLM-generated via the Anthropic API.
- **Page:** `/workspace`.

This doc answers the remaining open questions from the handoff.

---

## 1. Page that renders the ticker list

Confirmed: **`/workspace`**.

- Route file: `app/workspace/page.tsx`
- The page renders `<ResearchPanel />` + `<PortfolioPanel />` in a two-pane layout.
- The ticker list lives inside `components/ResearchPanel.tsx`. It calls `fetchGainers()` from `lib/polygon.ts` which hits the internal route `GET /api/gainers`.
- Phase 3E's new "Today's Ranked Research" block will render inside `ResearchPanel.tsx` (under the existing gainers table), not in a new page.

`/surf` uses the same two components (just a different layout), so the feature is visible there too for free.

---

## 2. Ticker-list filter logic — reality vs the handoff's description

**The handoff describes a "small-cap filter in the $20M–$100M market-cap range that excludes ETFs/SPACs/warrants." That is not what the code does.** The actual filter is a top-gainers filter with ticker-string sanitation. Worth flagging before we build on top of it — if a real market-cap filter is intended for Phase 3E, we need a separate change. My working assumption is that we proceed with what exists today.

### Source

`app/api/gainers/route.ts` (GET). Two code paths based on NY time:

### Pre-market / weekend path (before 9:30am ET or Sat/Sun)

Iterates the full Polygon snapshot (`/v2/snapshot/locale/us/markets/stocks/tickers`) and keeps rows where **all** of:

| Check | Threshold |
|---|---|
| `filterTicker(t.ticker)` passes | see below |
| `t.lastTrade?.p` present and `t.prevDay?.c > 0` | both required |
| Price | `≥ $1` |
| `t.min?.v` (most recent min-bar volume) | `≥ 1000 shares` |
| `(price - prevClose) / prevClose * 100` | `> 5%` |

Sorted by change % desc. Top 10.

### Market-hours path (9:30am ET onwards, weekdays)

Calls Polygon's gainers endpoint `/v2/snapshot/locale/us/markets/stocks/gainers`. Filters:
- `filterTicker` passes
- `t.day.c ≥ 1`

Sorted by Polygon (server-side). Top 10 after filtering.

### `filterTicker()`

```ts
function filterTicker(ticker: string): boolean {
  if (!ticker || typeof ticker !== "string") return false;
  if (/W$|WS$|WT$|R$|U$/i.test(ticker)) return false;  // warrants, rights, units
  if (ticker.includes(".")) return false;              // class shares (BRK.A)
  if (ticker.length > 5) return false;
  return true;
}
```

### What's *not* filtered

- **No market-cap filter.** `marketCap` comes from Polygon's `/v3/reference/tickers/${ticker}` endpoint, which is only called inside the per-ticker research pipeline (layer 1), not at list-selection time. Nothing today caps list membership by cap.
- **No ETF exclusion.** Would require per-ticker lookup of `t.type === "ETF"` vs `"CS"` (common stock), which Polygon only exposes on `/v3/reference/tickers`. Not wired.
- **No SPAC exclusion.** Harder — SPAC detection is typically heuristic (name contains "Acquisition Corp", ticker suffix, etc.). Not attempted anywhere.
- **Warrant / rights / unit exclusion is *suffix-based only*** — catches `XYZW`, `XYZWS`, `XYZWT`, `XYZR`, `XYZU`. Won't catch warrants whose ticker happens to end differently.

### Implication for Phase 3E

Since the list is "top 10 gainers that survive a regex sanitation pass" rather than a market-cap filter, the feature title "small-cap ranked research" is slightly mis-advertising. **I'd lean into it as "top gainers ranked research" in the UI copy** unless you want me to also add a proper market-cap filter in Commit 2.

---

## 3. Research pipeline — file path and interface

### Entry point

`app/api/research/route.ts` — `GET /api/research?ticker=XYZ` returns a `ResearchBrief`.

### Brief shape

`types/research.ts`:
```ts
interface ResearchBrief {
  ticker: string;
  market: MarketData | null;         // Polygon: company, cap, float, price, volume
  fundamentals: Fundamentals | null; // SEC EDGAR: 10-K/Q form, going concern, shelf, cash/revenue/NI
  news: NewsData | null;             // { exaResults[], perplexitySummary }
  status: "complete" | "partial" | "error";
  errors: string[];
  researchedAt: string;
}
```

### Orchestration

Three layers fired in parallel via `Promise.allSettled`:

| Layer | Source | Roughly |
|---|---|---|
| 1. Market | Polygon: `/v3/reference/tickers/:t`, `/v2/aggs/.../prev`, `/v2/snapshot/.../tickers/:t` | <1s |
| 2. Fundamentals | SEC EDGAR: full-text search → CIK → submissions + companyfacts + filing HTML download + text parse for going concern / liquidity section / S-3 shelf detection | 3–8s (slowest — EDGAR is sequential, filing HTML downloads can be ~MB) |
| 3. News | Exa (`/search` neural) + Perplexity (`sonar-pro` chat) in parallel | 2–5s |

Typical total per ticker: **~5–10 seconds** end-to-end, bottlenecked by EDGAR + Perplexity.

### Interface is simple enough to reuse

Single-ticker, stateless, returns a self-contained brief. Phase 3E's `run-daily` handler can simply loop over today's tickers and call this route N times (or call the three layer functions directly if we want to skip the extra HTTP hop).

### Related: existing Claude analysis endpoint

`app/api/analyze/route.ts` already calls Anthropic on an array of briefs and returns a per-ticker signal/target/stop + a single `topPick`. It uses `claude-sonnet-4-20250514` and a ~700-token prompt. The model call is ~$0.01/run. **Phase 3E's ranking step is functionally close to this existing endpoint** — the difference is we want `rank: number` + `rank_reason: string` per ticker rather than signal+prices. Cleanest path: new `/api/research/run-daily` route that internally reuses the fetch pattern + adds the ranking call, rather than extending `/api/analyze` with a new shape.

---

## 4. Typical ticker count

**~10 per day.** Both paths in `app/api/gainers/route.ts` cap at `slice(0, 10)`. Sometimes fewer if pre-market filtering eliminates a chunk.

### Implications for daily run

With 10 tickers and ~5–10s per brief:

- **Sequential:** ~50–100 seconds. Over Vercel's 60s serverless function timeout (Hobby) or 300s (Pro). If we're on Pro, sequential fits.
- **Parallel (`Promise.allSettled`):** ~10s total, dominated by the slowest single brief. Comfortably inside any Vercel tier.

**Recommendation:** parallel `Promise.allSettled` over the ticker list in `run-daily`. If any individual brief fails it lands in the row with `status: "error"` rather than taking down the whole batch.

EDGAR has a rate limit of 10 req/s from a single IP. Each brief does ~3 EDGAR requests. 10 tickers × 3 req = 30 requests in ~10 seconds, roughly at the limit. Acceptable; if we bump into 429s we'll throttle with a small pool-size limit (say, 5 concurrent).

Anthropic ranking call afterwards: one request taking all N briefs at once. ~2–3 seconds.

**Total daily job runtime: ~15–20 seconds worst case.** Easy Vercel cron target.

---

## 5. Buddy: push or pull?

**Current code: neither. Research is 100% on-demand from Next.js API routes.**

- `README.md` (lines 10, 45–51) describes an older queue architecture: "Buddy polls the DB for `pending` research rows and writes results." That architecture is not reflected in the current codebase.
- `app/api/research/route.ts` calls Polygon, SEC EDGAR, Exa, and Perplexity directly, inside the Next.js serverless runtime. There is no queue table, no pending/processing/complete status lifecycle, no Buddy-side worker.
- `grep -rn "buddy\|openclaw\|45.55.64.14"` in the codebase turns up only the stale README and this handoff. No wiring.

### Implication for Phase 3E

**Daily refresh should run in Vercel, not on Buddy.** Reasons:
1. No existing Buddy integration to extend. Introducing one just for this feature is extra deployment surface.
2. Job runtime (~15–20s) comfortably fits a Vercel Cron-triggered route.
3. All required API keys (Polygon, Exa, Perplexity, Anthropic) are already in Vercel env.
4. The Supabase writes happen via service-role client, which already works from Next.js routes.

**Plan:** `vercel.json` with a cron entry pointing at `POST /api/research/run-daily`, scheduled for 4:30pm ET (21:30 UTC) weekdays. The handler runs auth-gated (admin role) so only cron + a manual admin trigger can hit it.

---

## LLM ranking prompt shape (Option B)

Since ranking is locked to LLM-generated, here's the proposed contract for Commit 3.

### Input assembly

Build a single Anthropic Messages API call per daily run. Reuse the existing `briefToSummary()` helper from `app/api/analyze/route.ts` (or lift it to a shared module) so the brief shape sent to the model stays consistent.

System prompt:
```
You are a ranking assistant for a day trader. You rank a small list of
stocks by how attractive each one is as a momentum play for the current
trading day. Your rank_reason for each stock is one sentence, specific and
concrete. Never refer to external data beyond what's in the brief.
```

User prompt template (pseudo):
```
Rank the following ${N} stocks from #1 (best momentum play today) to #${N}
(worst). For each stock, give a rank_reason (one sentence, ≤ 200 chars)
that explicitly cites:
  1. the primary catalyst or current price action,
  2. the strongest risk flag (going concern, shelf registration,
     low cash on hand, extreme % gain suggesting extension),
  3. a setup quality signal (float size, volume vs average) when available.

${ briefToSummary(briefs[0]) }

---

${ briefToSummary(briefs[1]) }

... (repeat for all N briefs, separated by "---")

Respond with ONLY valid JSON, no prose outside the JSON object:

{
  "ranked": [
    { "ticker": "ABC", "rank": 1, "rank_reason": "..." },
    { "ticker": "DEF", "rank": 2, "rank_reason": "..." }
  ]
}
```

### Output parsing

Same pattern as `app/api/analyze/route.ts`:
```ts
const text = data.content?.[0]?.text;
const jsonMatch = text.match(/\{[\s\S]*\}/);
const parsed = JSON.parse(jsonMatch[0]) as { ranked: Array<{ticker: string; rank: number; rank_reason: string}> };
```

### Defensive handling

- **Ticker/rank sanity check:** verify every ticker in the response appears in the input briefs list (guards against Claude hallucinating a ticker). Drop mismatches, log a warning, mark affected rows with `rank: null` and `rank_reason: null` in the DB so the cache still lands.
- **Rank contiguity:** sort by rank asc on write. If ranks have gaps or dupes, keep as-is — the UI just sorts by `rank asc` so duplicates will be ordered by ticker secondarily.
- **Length cap on `rank_reason`:** hard-cap at 300 chars on insert so a verbose model response doesn't blow up the JSONB column or table scanner.
- **Model fallback:** if Anthropic returns non-parseable JSON or fails, insert rows with `rank: null` and `rank_reason: null`. Research still cached, ranking just missing — UI renders the row with a "—" rank badge. Better than failing the whole daily run.

### Cost estimate

Roughly 10 briefs × ~1 KB summary ≈ 10 KB input → ~2.5K tokens in. Output ~400 tokens. At `claude-sonnet-4-20250514` pricing (~$3/M in, $15/M out) that's **≈ $0.015 per daily run**. 365 days/yr × $0.015 = ~$5.50/yr in ranking cost. Trivial.

### Model choice

Match the existing `/api/analyze` route (`claude-sonnet-4-20250514`) so both endpoints stay on the same version. If we ever want to upgrade, both move together.

---

## Proposed Commit 2 scope (for Rob's sign-off)

If the above is all OK, Commit 2 builds:

1. **Migration** `supabase/migrations/20260414_ticker_research.sql` — exactly the schema from the handoff (`ticker_research` table + PK + index + RLS). Unapplied until Rob runs it.
2. **`GET /api/research/cached`** — auth-gated (user), reads today's rows from `ticker_research` joined by date, returns `{rows: [{ticker, rank, rank_reason, research, last_price, last_price_updated_at, created_at}], asOfDate}` ordered by rank asc. Falls back to most recent date if today is empty (handles the "cron missed a day" case up front).
3. **`POST /api/research/refresh-prices`** — auth-gated (user), accepts `{tickers: string[]}`. For each ticker, single Polygon snapshot call for last price. Updates `last_price` + `last_price_updated_at` on the row. Returns `{prices: {TICKER: {last: number, at: string}}}`. Uses `Promise.allSettled` so one bad ticker doesn't poison the batch.
4. **`POST /api/research/run-daily`** — auth-gated (admin only). Stubbed for Commit 2; full orchestration wires in Commit 3.

No UI changes in Commit 2. UI lands in Commit 4.

---

## Flags for Rob

1. **The ticker list is "top gainers," not "small caps."** Proceeding on that basis for Phase 3E unless you want a real market-cap filter bolted on. Easy add — 3 lines of Polygon snapshot inspection in `gainers/route.ts`.
2. **README.md describes stale architecture** (Buddy polling DB for pending research). Either rewrite the Research flow section to match reality or leave as-is — flagging but not fixing in this phase.
3. **No ETF/SPAC exclusion exists today.** If a gainer is an ETF, it'll show up in the list and get a (probably empty) research brief because SEC EDGAR won't have a 10-K for it. Fine for now; flag.
4. **`claude-sonnet-4-20250514` is the existing model version.** I'm proposing the ranking call use the same. If you'd rather use Opus for the ranking step (smarter reasoning at higher cost, ~5x more expensive ≈ $0.075/run ≈ $27/yr) say so and I'll switch.
5. **Vercel Cron needs a Pro plan** for reliable scheduled executions (Hobby has lower frequency limits). If we're on Hobby, alternative is Supabase's `pg_cron` extension firing an HTTP request against the route, which works around the plan constraint. Tell me which tier you're on and I'll pick the right cron surface in Commit 3.

---

*Next step: Rob reviews → green-light → I build Commit 2.*
