---
name: cmp-system
description: Rob Booker's Longboard CMP (Current Monthly Pivot) trading system. Use when identifying or grading a Longboard CMP setup on a chart (Class A / Class B), explaining a CMP trade or its entry, stop and targets in chat, answering questions about the CMP, Ghost Pivot, 200 SMA / 9 EMA dip bounce, or building or reviewing indicators, scanners and detectors for it (Pine Script, lib/cmpSystem.ts).
---

# Longboard CMP system

Rob Booker's day-trading system for long trades around the **Current Monthly
Pivot (CMP)**. This skill covers **Setup 1: under the CMP, the 9 EMA dip
bounce**, which is specified in code. Setup 2 (above the CMP, VWAP) is
summarised at the end and is not yet in code.

Sources, in order of authority:

1. Rob's rulings of 16 Oct 2026 (below). These revise the 8 Oct 2026 rule sheet.
2. Rob's indicator, version 2: `reference/lb-cmp-bounce-v2.pine` (Pine v6),
   and its TypeScript port `lib/cmpSystem.ts`. `rules.yaml` is the
   machine-readable version. Rob's original script is kept unchanged at
   `reference/lb-cmp-bounce.pine` (v1); the port reproduces it with
   `version: 1`.
3. The worked example `examples/2026-10-16-SGRX.md`.
4. The 8 Oct 2026 rule sheet ("Buying below / above the CMP"), only where
   nothing newer says otherwise.

## Levels

- **CMP**: last month's (high + low + close) / 3, **including pre-market and
  after-hours**.
- **Ghost Pivot**: month-to-date (high + low + latest price) / 3, extended hours
  included. It is what next month's pivot would be if today were the first day
  of next month.
- **200 SMA** and **9 EMA** on closes; **VWAP** (daily, typical price).
- **HOD**: high of day, extended hours included.
- Always use **extended-hours charts** (1-, 2- or 5-minute; the worked example
  is 2-minute).

## Setup 1: under the CMP, 9 EMA dip bounce

Price is **under the CMP**. The sequence, in order:

1. **Strong move.** Price runs well above the 200 SMA (default: the high gets
   at least 10% above it).
2. **Pullback toward the 200 SMA.** This sets the grade:
   - **Class A**: price touched or went below the 200 SMA. A "done dip": the
     shorts are done for now. This is the preferred setup.
   - **Class B**: a near miss. Price came close but did not touch (default
     window: the low within 9% above the 200 SMA). Tradeable, but size smaller.
   - If price flushes to or through the 200 SMA before it reclaims the 9 EMA,
     the grade upgrades from B to A.
3. **Reclaim.** A candle closes back above the 9 EMA.
4. **Dip.** A **red** candle dips back to the 9 EMA and holds it (touches it and
   does not close meaningfully below it; default tolerance 4%). If price closes
   below the 9 EMA instead, go back to waiting for a reclaim.
5. **Trigger.** Buy when price trades above **the red dip candle's high**. An
   intrabar break is fine: you do not wait for the candle to close. If another
   red candle dips to the 9 EMA first, the trigger moves to that candle's high.
   If no trigger comes within a while (default 10 bars; v2 can also set a
   minutes limit), the dip is stale; wait for a new one.
6. **Only under the CMP.** The fill must be below the CMP. If price breaks out
   above the CMP, it is not this setup.

### Stop

**Under the lows of the candles that bounced off the 9 EMA** (the candles from
after the reclaim, up to the trigger). Not a fixed percentage and not just
under the current 9 EMA value. The script adds a small buffer (1%) and can
optionally include the reclaim candle's low. If the trigger is missed and the
setup re-arms, the stop moves to the new bounce candles.

### Targets

- **T1 = high of day.** The best first target.
- **Stall zone** = midpoint of VWAP and HOD. Expect the bounce may pause here.
- **Stretch targets**: the Ghost Pivot, then the CMP.
- Optional: after T1, move the stop to breakeven and try for more.
- A drop back below the 9 EMA during the trade is a warning; the hard exit is
  the stop.
- v2 closes a trade still open at the end of the day at the last close ("EOD")
  when "Start fresh each trading day" is on.

### When to pass

- No strong move first, or no pullback toward the 200 SMA.
- No reclaim of the 9 EMA, or no red dip back to it (do not buy the first
  breakout above the 9 EMA).
- The trigger price is at or above the CMP.
- No room: the high of day is not above the entry.
- The distance to T1 does not justify the distance to the stop (judgement; no
  numeric reward-to-risk minimum has been set).

### Grading and explaining a setup in chat

When asked about a chart, walk the sequence and say which step it is on:
"strong move, Class B pullback (low 0.684 vs 200 SMA 0.63, no touch), reclaim,
waiting for a red dip". For a trade, give the grade, trigger (dip candle high),
stop (bounce lows), T1 (HOD), stall zone, Ghost and CMP. Say "Class B: size
smaller" when it is a near miss. Never call a near miss Class A.

## What is NOT a rule

- Things Rob said once about one trade, e.g. the company being Chinese in the
  SGRX example. Observations are not filters.
- The script's numbers: 10% strong move, 9% Class B window, 4% 9 EMA tolerance (Rob set 9% / 4% on 17 Oct 2026; v1 used 7% / 1%),
  10-bar wait, 1% stop buffer. These are **tunable defaults**, not Rob's rules.
  When a real chart disagrees with a threshold, trust the chart and say which
  threshold missed.
- Minimum RVOL, minimum volume, float, news or fundamentals: none specified.
- A mandatory 200 SMA touch: Class B exists precisely because it is not.
- Position sizing formulas: only "smaller for Class B".
- From the superseded 8 Oct sheet: "stop below the 200 SMA", "trigger above the
  reclaim candle's high" and "target the CMP" for Setup 1. The 16 Oct rulings
  replace them with the stop under the 9 EMA bounce lows, the dip candle's high
  as the trigger, and HOD as T1 (CMP is a stretch target).
- The 70% candle condition from the webinar is optional.

## Building detectors and indicators

- Use `lib/cmpSystem.ts` (`runCmpSystem`). It is a bar-by-bar port of the v2
  Pine state machine (`version: 1` for the original); feed it **extended-hours** bars and either 60-minute
  extended-hours bars covering the whole previous month (`hourBars`) or a
  completed-month H/L/C list (`monthly`) for the CMP. Pass `mintick` (0.0001 for
  most sub-$1 stocks).
- Stages: 0 waiting for strong move, 1 waiting for pullback, 2 waiting for 9 EMA
  reclaim, 3 waiting for red dip, 4 armed, 5 in trade. `rules.yaml` lists every
  transition in order.
- Keep thresholds as settings, never hard-coded rules. Results are sensitive to
  the data vendor: on SGRX 16 Oct, Polygon's bars missed the 7% window and the
  1% dip tolerance where Rob's TradingView chart did not; 9% / 4% matched
  (see the example).
- v2 changes from v1 are listed in the header of `lb-cmp-bounce-v2.pine`.
- Parity notes (EMA seeding, session boundaries, request.security) are at the
  bottom of `lib/cmpSystem.ts`.

## Setup 2: above the CMP, VWAP — not yet specified in code

From the 8 Oct 2026 rule sheet; Rob has not revised it and there is no script.

1. A stock moves above the CMP, then pulls back and bounces from the CMP or the
   200 SMA.
2. Price reclaims **VWAP** (a bounce without a VWAP reclaim is not enough).
3. Price pulls back to VWAP. Do not buy the first VWAP breakout.
4. Buy the bullish confirmation: an intrabar break above the high of the
   initial VWAP reclaim candle, or a completed green bounce candle.
5. Stop below both VWAP and the low of the confirming candle.
6. Target the existing high of the day; the core plan does not hold beyond it
   (a double top can attract short sellers).

Discretionary variations mentioned in the webinar (9 EMA above the CMP, stops
under the CMP or 200 SMA, VWAP as an intermediate exit) are not requirements.
