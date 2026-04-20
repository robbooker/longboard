# Long/Short Portfolio

**Status:** live (Phase 1 — morning-only, 1-position cap)
**Capital:** $100,000 — fresh Alpaca paper account, separate from the existing `PA35U6BCOIN6` account used by AutoTrade.

## Mandate

Make trading decisions based on current events. Do not lose a lot of money when you are wrong.

## Specification

- **Universe (longs):** All US stocks. No market cap floor.
- **Universe (shorts):** S&P 500 only. (Shorts arrive in Phase 2. The universe constraint is hard-coded now so nothing downstream ever proposes a non-S&P short.)
- **Forbidden everywhere:** leveraged ETFs, inverse/short ETFs, options.
- **Book size:** 15–20 combined positions (Phase 2). **This phase caps at 1 position.**
- **Position sizing:** 3% minimum, 7% maximum per position. Claude picks within the range by conviction.
- **Stops:** Claude sets a stop per position at entry. The stop **must** be stated numerically in the rationale. No stop = no order.
- **Schedule:** 9:00 CT morning (this phase). 3:05 CT end-of-day and 3:30 CT Friday weekly arrive in Phase 2.
- **Morning inputs:** top financial news last 12h (Exa), overnight/pre-market earnings (Polygon), economic calendar, pre-market movers (Polygon), per-ticker drill-in via existing Longboard research pipeline (Polygon + Brave + SEC EDGAR + Exa).
- **Earnings on held positions:** Claude decides per position. Must state reason if holding through.
- **Overnight/weekends:** Hold through.
- **Output:** Slack post + Supabase writeup + `/strategies/long-short` page.
- **Review cadence:** Friday checkpoints (Phase 2). First 8 weeks mechanical checks only; P&L vs SPY matters from week 8 onward. Two bad reviews in a row → stop or rebuild.

## Phase 1 vertical slice

- One morning run per day, Mon–Fri, market holidays skipped.
- Capped at 1 position.
- Research bundle + Claude decision + Alpaca paper order + Supabase write + Slack post.
- Deferred to Phase 2: ranking logic, rotation cap, book size scaling, shorts, 3:05 CT EOD, 3:30 CT Friday review, equity curve, SPY comparison.

## Phase 1 success criteria

1. The cron fires on three consecutive weekdays without manual intervention.
2. Each run posts to Slack within 90 seconds of starting.
3. Every run is visible on `/strategies/long-short` with readable rationale.
4. At least one run produces an actual paper order (not all three skip).
5. No zombie rows: every `strat_positions` row has a matching `strat_trades` row, and `strat_runs.status = 'ok'` matches the presence of a filled order.
6. The runbook reads cleanly to Rob on a Monday morning.
