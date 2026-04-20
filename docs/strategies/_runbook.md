# Long/Short Portfolio — runbook

Written for 7 a.m. Monday, when the cron misfired and you have coffee
in one hand. Skim the quick reference, then read the relevant section.

> **Status as of 2026-04-20:** Phase 1 vertical slice. Morning routine
> only, one position cap, paper money.

---

## Quick reference

| Action | How |
|---|---|
| See last run's decision + writeup | Open https://longboard-ruddy.vercel.app/strategies/long-short |
| Pause the strategy | In Supabase SQL editor: `update strategies set status = 'paused' where id = 'long-short';` |
| Unpause | `update strategies set status = 'live' where id = 'long-short';` |
| Manually trigger a run (live) | On claudebot machine: `npm run strategy:long-short:morning` |
| Manually trigger a dry run | `npm run strategy:long-short:morning -- --dry` |
| Smoke-test the Claude pipeline | `npm run strategy:long-short:smoke` |
| See last 5 runs in SQL | `select ran_at, status, error, (output->>'decision') as decision from strat_runs where strategy_id='long-short' order by ran_at desc limit 5;` |
| Slack channel | `#longboard-strategies` |

---

## What the cron does

At **9:00 CT Mon–Fri** (30 minutes after market open in ET), the
OpenClaw cron fires `npm run strategy:long-short:morning`. That
routine:

1. Pings Alpaca + Polygon + Exa + Finnhub. If any is down, aborts
   before any Claude tokens are spent and posts a `:warning:` in Slack.
2. Checks if today's morning run already completed (status `ok`) or
   is in-flight (status `running`). Skips if so.
3. Checks the US market calendar. Skips on holidays (weekends are
   already excluded by the cron schedule).
4. Inserts a `strat_runs` row with `status='running'` — this is the
   concurrency sentinel. A second process starting mid-run will see
   it and skip.
5. Pulls the research bundle: Exa news (last 12h), Finnhub earnings
   (yesterday-AMC + today), Polygon pre-market movers.
6. Sends the bundle to Claude Sonnet 4, which may call the
   `drill_in` tool up to 3 times for deeper per-ticker research.
7. Claude returns a JSON decision — either `enter` (with ticker,
   size, stop, thesis, writeup) or `skip` (with thesis + writeup).
8. Server-side enforces constraints: ticker not on the forbidden
   leveraged/inverse ETF list, side is long, size in [3%, 7%], stop
   below entry, book cap not exceeded.
9. On `enter`: sizes the order, places an Alpaca paper market order,
   writes `strat_positions` + `strat_trades`, updates the run row to
   `ok`.
10. Posts a Slack message summarizing what happened.

A full run in dry mode costs roughly 1–3 API calls to each vendor
plus ~0.03 USD of Anthropic tokens. A live run adds the Alpaca POST
and the three Supabase writes.

---

## Installing the cron (one-time setup on OpenClaw)

### Prerequisites

Before installing the cron, make sure these are in OpenClaw's session
env (the env seen by `su - openclaw -s /bin/bash`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POLYGON_API_KEY`
- `EXA_API_KEY`
- `FINNHUB_API_KEY`            ← new for Phase 1
- `ANTHROPIC_API_KEY`
- `SLACK_STRATEGIES_WEBHOOK_URL` ← new for Phase 1

Also:

- The Longboard repo must be cloned on the OpenClaw host, and the
  path to it must be accessible to the `openclaw` user. The
  `--system-event` line below assumes the cron lands as a Claude Code
  event and the agent navigates to the repo; if OpenClaw's session-main
  uses a fixed working directory, adjust the event wording accordingly.
- `npm install` must have been run recently enough that `tsx` and all
  other deps are present in `node_modules/`.
- The Supabase migrations must be applied through today's date
  (Phase 1 relies on `strategies`, `strat_runs`, `strat_positions`,
  `strat_trades`, and the `user_broker_keys` strategy-scope extension).
- The Alpaca paper-trading creds must be seeded in the vault for
  `strategy_id = 'long-short'`.

### The command

Run on the OpenClaw host, as the `claudebot` user (or whichever user
the `su - openclaw` hop expects):

```bash
su - openclaw -s /bin/bash -c 'openclaw cron add \
  --name "longboard-strat-long-short-morning" \
  --schedule "0 9 * * 1-5" \
  --tz "America/Chicago" \
  --session main \
  --system-event "Run Long/Short Portfolio morning routine. Change to the Longboard repo directory and execute: npm run strategy:long-short:morning. Post the stdout to #longboard-strategies if anything looks wrong."'
```

Key flags — do not change these without reading OpenClaw's cron docs:

- `--session main` — critical. Without this, the cron runs in an
  isolated session with no secrets and no memory.
- `--system-event` — the daemon interprets this as a Claude-Code
  event, using the daemon-configured model. (A `--model` flag here
  is silently ignored; don't rely on it.)
- `--tz "America/Chicago"` — the schedule `0 9 * * 1-5` is evaluated
  in this timezone, so DST transitions are handled by OpenClaw
  rather than by us computing UTC offsets.

### Verifying install

```bash
su - openclaw -s /bin/bash -c 'openclaw cron list' | grep long-short
```

Should show the entry with schedule `0 9 * * 1-5`.

### Deleting the cron

**Use the job id, not the name** — OpenClaw's `cron delete` works
by id only:

```bash
su - openclaw -s /bin/bash -c 'openclaw cron list'   # find the id
su - openclaw -s /bin/bash -c 'openclaw cron delete <id>'
```

---

## How to pause the strategy

Two paths, depending on how much you want it off.

### Soft pause — rows stop being written

Flip the strategy row's status:

```sql
update strategies set status = 'paused' where id = 'long-short';
```

This has **no effect on the morning-run code today** — the routine
doesn't consult `strategies.status`. It does, however, change the UI:
the live card moves off the LIVE rack and shows as planned/paused.

If you want the soft-pause to actually stop the cron from running,
either also delete the OpenClaw cron (see above) or ship a small
Phase 2 change: check `strategies.status` at the top of
`runLongShortMorning` and exit early if it's not `'live'`.

### Hard pause — cron stops firing

Delete the OpenClaw cron per "Deleting the cron" above. To resume,
re-run the install command.

---

## How to check the last run

### From the web

Open https://longboard-ruddy.vercel.app/strategies/long-short
(admin-gated). The page shows:

- **Status strip** at the top: last-run timestamp, decoration for
  `in progress` or `error`
- **Today's writeup:** the full Claude writeup, whether the decision
  was `enter` or `skip` (skip writeups surface too — the Commit 4
  addendum). An error run shows the error message in red.
- **Open positions:** current live paper positions
- **Recent trades:** last 25 trade rows

### From SQL

The fastest sanity check:

```sql
select
  ran_at, status, error,
  (output->>'decision') as decision,
  (output->>'ticker') as ticker
from strat_runs
where strategy_id = 'long-short'
order by ran_at desc
limit 10;
```

Full writeup for a specific run:

```sql
select writeup_md from strat_runs where id = '...';
```

---

## How to manually trigger a run

### Dry (no order, no DB writes, Slack tagged `[DRY]`)

```bash
cd /path/to/longboard
npm run strategy:long-short:morning -- --dry
```

Safe to run any time, any day. Useful for sanity-checking that the
research bundle still looks right and Claude still produces a valid
decision.

### Live (real order, real writes)

```bash
cd /path/to/longboard
npm run strategy:long-short:morning
```

The idempotency check will **refuse** to run if today's morning
run already completed successfully (`status='ok'`) or is in
progress (`status='running'`). If a previous run errored and you
want to retry, the check lets you through — `error` rows do not
block.

### Smoke test (mocked bundle, no DB writes, Slack tagged `[SMOKE]`)

```bash
cd /path/to/longboard
npm run strategy:long-short:smoke
```

Use before any code change to the morning routine: it verifies the
Claude pipeline + validator + Slack post path without burning
vendor-API calls on real data.

---

## How to read the Slack output

Every run posts exactly one message to `#longboard-strategies`.

### Enter

```
*Long/Short Portfolio — morning run*
Bought CZR · 42 shares @ $42.10 · stop $39.50 · size 5.5%
Thesis: Pre-market up 3% on analyst upgrade and raised guidance.
→ /strategies/long-short
```

### Skip

```
*Long/Short Portfolio — morning run*
Declined to trade today. Bundle has no clean catalyst — earnings volatility
across the mag-7 names makes single-name directional exposure unattractive.
→ /strategies/long-short
```

### Error

```
:warning: *Long/Short Portfolio — morning run ERROR*
preflight_failed: alpaca: http 401: invalid key
→ /strategies/long-short
```

### `[DRY]` or `[SMOKE]` prefix

Indicates a manual test run. These never place orders or write to the
database. If you see `[DRY]` or `[SMOKE]` on a day when you didn't
trigger one yourself, someone else did — probably an engineer.

---

## Error glossary

Every error message is a stable string. The left column matches the
prefix you'll see in Slack; the right column is what it means and
what to do.

| Error prefix | Meaning | First action |
|---|---|---|
| `missing env vars: X` | One or more required env vars is unset in OpenClaw's session env | Add to OpenClaw env; re-check via `openclaw env list` or the equivalent |
| `preflight_failed: alpaca: ...` | Alpaca paper account ping failed | Check Alpaca status page; verify the seeded vault creds match an active paper key |
| `preflight_failed: polygon: ...` | Polygon ping failed | Check Polygon status; verify `POLYGON_API_KEY` is current (keys can expire) |
| `preflight_failed: exa: ...` | Exa search failed | Check Exa dashboard; may be rate-limited or plan-tier issue |
| `preflight_failed: finnhub: ...` | Finnhub /quote failed | Check Finnhub dashboard; free-tier limits are generous but not infinite |
| `today_run_lookup_failed: ...` | Supabase read failed | Supabase status; may be rate limit or outage |
| `running_row_insert_failed: ...` | Supabase insert of sentinel row failed | Same — Supabase side |
| `bundle_failed: ...` | The whole research bundle threw (rare; usually individual layers fail gracefully) | Check vendor status pages; re-run dry to see which layer |
| `anthropic_failed: ...` | Claude call or tool-use loop failed | Check Anthropic status; verify `ANTHROPIC_API_KEY` and account balance |
| `claude_json_parse_failed: ...` | Claude returned non-JSON text | Usually a transient model hiccup; re-run. If it persists, the system prompt may need tightening |
| `decision_invalid: ...` | Claude's JSON parsed but violated the contract (wrong type, out-of-range size, missing stop) | Same as parse failure — transient or prompt drift |
| `last_price_failed: ...` | Polygon snapshot for the chosen ticker returned no price | Often the ticker is delisted or halted; re-run and Claude will pick differently |
| `constraints_violated: forbidden_ticker: ...` | Claude picked a leveraged or inverse ETF | Permanent constraint — Claude should know better; flag in docs/strategies/long-short.md if a new symbol keeps tripping it |
| `constraints_violated: stop_not_below_entry: ...` | Claude set a stop at or above the current price for a long | Same — model should know better |
| `constraints_violated: book_cap_exceeded: ...` | Already have 1 open position, can't open another (Phase 1 cap) | Either close the existing position first or wait — Phase 2 lifts this |
| `alpaca_account_failed: ...` | Alpaca /account call failed after preflight passed (race) | Re-run |
| `alpaca_order_failed: ...` | Order submission rejected by Alpaca | Look at Slack for the full HTTP body; common causes are halted ticker, insufficient buying power, or market closed |
| `qty_zero: ...` | Sizing math produced zero shares (price too high for the size allocation) | Almost certainly a thin-float small-cap at a huge price; Claude should avoid these |
| `persist_enter_failed: ... alpaca_order_id=X` | **Order went live but DB writes failed partially.** Rob must manually reconcile | Get `alpaca_order_id`, check Alpaca for fill, then either flatten the position on Alpaca or manually insert the missing rows |
| `PARTIAL WRITE: ...` | Same as above, prefix in Slack error post | Same |

The two that should get your attention at 7 a.m. on Monday:

- **`persist_enter_failed` / `PARTIAL WRITE`**: there's a live order on
  Alpaca that the Supabase audit trail doesn't fully capture. Reconcile
  before the next run fires.
- **`constraints_violated: book_cap_exceeded`**: indicates a stale
  position row (closed on Alpaca but not in Supabase). Phase 2 will
  handle closes; for now, manually `update strat_positions set
  closed_at = now(), pnl = <realized>, closed_by_run_id = null where
  id = '...'` to clear it.

---

## Phase 1 limitations (read once)

- **One position, ever.** Morning run won't place a second order
  while any position is open.
- **No end-of-day monitor.** Once a position is on, nothing
  automated will close it. Stops on Alpaca are not wired; Claude's
  stated stop lives in `strat_positions.stop_price` for the record
  but isn't sent as a bracket order. Manual exits or Phase 2's EOD
  routine.
- **No Friday review.** The write-up you get on Fridays is whatever
  the morning run produced. Phase 2 adds the 3:30 CT weekly.
- **Shorts not possible.** Schema and constraint both reject `side:
  'short'`.
- **Econ calendar not in the bundle.** Deferred from Phase 1 per
  audit Q4. Claude gets news + earnings + movers only.

---

## Phase 1 success criteria (tracking)

From the handoff:

1. ☐ Cron fires on three consecutive weekdays without manual
   intervention.
2. ☐ Each run posts to Slack within 90 seconds of starting.
3. ☐ Every run is visible on `/strategies/long-short` with readable
   rationale.
4. ☐ At least one run produces an actual paper order (not all three
   skip).
5. ☐ No zombie rows: every `strat_positions` row has a matching
   `strat_trades` row, and `strat_runs.status = 'ok'` matches the
   presence of a filled order.
6. ☐ This runbook reads cleanly to Rob on a Monday morning.

Check off as we get there.
