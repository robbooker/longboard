# Longboard Morning Report Automation Plan

Date: May 5, 2026
Status: superseded planning note, not implementation

Superseded May 7, 2026 by `docs/morning-report-automation-v1-spec.md`.
That v1 spec reflects the resolved product decisions from Rob and should be
treated as canonical where these documents disagree.

## Core Idea

The morning report should become a living report of record for the trading day.
It should refresh automatically throughout the day, feed Command Center, and
always be ready to render as email HTML.

Email sending stays manual. The system maintains the report; Rob decides if and
when to send it.

## Important Clarification

The picks are not frozen for the day.

The board can change during the session. New names can enter, old names can
fall out, and the ranking can change as market data changes. The system should
behave like a live ranked board with cached daily intelligence attached to each
ticker.

## What Refreshes Often

Every 15 minutes during the operating window, a scheduled refresh should update
the cheap, market-data-shaped parts of the report:

- current price
- percent change
- volume
- relative volume if available
- gap/session status
- key level status if available
- ranking score
- ranked order
- which names belong in the current top board
- last refreshed timestamp

This refresh can change the displayed picks and ranking.

## What Stays Cached

Expensive work should be cached per ticker per trading day:

- research narrative
- source-backed catalyst notes
- price targets
- structural commentary
- higher-level editorial framing

If a ticker was researched today, reuse that research for the rest of the day
unless Rob manually regenerates it.

## New Ticker Rule

If a scheduled refresh promotes a new ticker into the report and that ticker
does not have research for today, the system should generate research for that
ticker once, cache it, and attach it to the report.

If an existing ticker simply changes rank, do not regenerate research.

In short:

```text
Candidate universe refreshes frequently
→ cheap market-data score ranks names
→ top names can enter or leave the board
→ new ticker with no same-day research triggers one research build
→ existing researched ticker reuses cached intelligence
→ Command Center and email rendering read the current report
```

## Scheduling Model

Use scheduled jobs to maintain the report:

- A heavy morning build runs once per trading day before/near the open.
- A lightweight refresh runs about every 15 minutes during the chosen market
  window.
- A manual admin action can force a rebuild, regenerate a ticker, or refresh the
  board.

On Vercel, the natural scheduler is Vercel Cron Jobs calling protected API
routes such as:

```text
/api/cron/morning-report-build
/api/cron/morning-report-refresh
```

Each cron route should verify a secret, check whether it should run, then update
the report safely.

## Manual vs Automatic

Automatic:

- build the day’s report
- refresh prices and market-data fields
- recalculate rankings
- add newly promoted tickers
- generate same-day research only for newly promoted tickers that need it
- keep Command Center current
- keep email HTML renderable from the current report

Manual:

- send email
- override copy
- regenerate narrative if Rob decides something material changed
- force refresh or rebuild from admin
- publish/finalize if that concept is added later

## State And Recovery

The system should never replace good state with bad state.

A refresh should:

1. Load the current report.
2. Build a candidate update.
3. Validate the candidate.
4. Promote it only if valid.
5. Leave the previous good report in place if anything fails.

Useful states:

```text
not_started
building
live
stale
failed_but_serving_last_good
closed
```

Command Center should always show the last good report plus a clear last
refreshed timestamp.

## Data Model Direction

The concept should move away from `morning_email_archive` as the main noun.

Better noun:

```text
daily_reports
morning_reports
```

The report is the canonical object. Email is just one export/rendering action.

Potential related records:

- current report pointer
- report versions or snapshots
- per-ticker daily research cache
- refresh/run log
- failure log

## Version History

Keep enough history to debug and roll back, but do not overbuild it.

Recommended starting point:

- keep current report of record
- keep final daily report history permanently
- keep intraday promoted versions for a limited period
- prune noisy 15-minute snapshots later if needed

## Admin Surface

The admin surface should eventually become a control room:

- current report status
- last heavy build time
- last lightweight refresh time
- current top names and rank changes
- cached research status per ticker
- force refresh
- regenerate selected ticker
- regenerate full narrative
- render/copy/download email HTML
- visible failure log

## Open Questions

- What exact refresh window should we use? 7:00am ET, 9:00am ET, 9:30am ET,
  or another window?
- What scoring formula determines the live ranking?
- How many names are in the candidate universe before top-board selection?
- Should new ticker research happen inside the 15-minute refresh, or should the
  refresh enqueue a separate research job?
- How much intraday version history do we keep?
- What failure threshold should alert Rob versus only showing admin status?

## Guiding Principle

Build the report noun first, then attach verbs to it.

The report is maintained automatically. Sending is a deliberate human action.
