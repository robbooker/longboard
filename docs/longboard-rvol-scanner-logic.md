# Longboard RVOL Scanner Logic

Date: May 22, 2026

This documents the local TradePod / POD live scanner logic so the LongboardAI morning email admin scanner can use the same stock-finding process.

## What It Scans For

The scanner looks for small-cap common stocks making large same-day moves with enough volume to matter. The current universe rules are:

- U.S. stocks from Polygon's all-stock snapshot feed.
- Common stock only: Polygon reference `type` must be `CS`.
- Price between `$1` and `$20`.
- Same-day gain at least `30%`, using the current day close from the snapshot against previous close.
- Current day volume at least `500,000` shares.
- Market cap must be greater than zero and below `$100,000,000`.
- Obvious SPAC / blank-check names are excluded.
- Warrant-like ticker suffixes are excluded in the LongboardAI morning email scanner.

After those filters, candidates are sorted by same-day percentage gain, highest first. The morning email admin scanner takes the top five names from that ranked universe.

## How The Live Scanner Works Intraday

The live POD scanner has two layers.

First, it refreshes the candidate universe every 60 seconds from Polygon snapshots. This catches new gappers and keeps the live candidate list current.

Second, it subscribes to Polygon aggregate-minute websocket bars for the market. It ignores symbols outside the current candidate universe, then builds 5-minute candles from the 1-minute feed.

For a live trade signal, a candidate must pass all of these 5-minute conditions:

- It is inside the entry window.
- There are enough 5-minute bars to calculate the indicators.
- The symbol has not already signaled that day.
- Close is still between `$1` and `$20`.
- Day gain is still at least `30%`.
- Day volume is still at least `500,000`.
- Prior 5-minute candle is red.
- Current 5-minute close is above the prior candle high.
- Current close is above EMA 9.
- Current close is above VWAP.
- Current close is above premarket high.
- Relative volume is at least `4.0`, using a 20-bar 5-minute lookback.

When all checks pass, the live scanner records one signal for that symbol for the day. If paper trading is enabled and open-position limits allow it, it sends an Alpaca paper market order.

## Morning Email Integration

The LongboardAI admin morning email scanner now uses the same universe-finding process for its first step. In production, it first asks TradePod for the latest RVOL scanner snapshot. If that feed is not configured, stale, or unavailable, it falls back to Longboard's own Polygon scan:

1. Fetch the TradePod RVOL top-stocks snapshot.
2. If TradePod has usable names, put those names into `/admin/morning-email`.
3. Otherwise, fetch Polygon all-stock snapshots.
4. Apply the Longboard RVOL universe filters.
5. Sort by same-day percentage gain.
6. If fewer than five live-now names pass, backfill remaining slots from the local POD scanner journal for names actually seen after today's 4:00 AM ET scanner start.
7. Admin can then run research, target generation, and preview generation from those names.

The morning email scanner does not require the full intraday 5-minute signal pattern. It is meant to find the morning watchlist universe, not prove that a live trade signal has fired.
