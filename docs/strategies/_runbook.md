# Long/Short Portfolio — runbook

Written for 7 a.m. Monday, when the cron misfired and you have coffee
in one hand. Skim the quick reference, then read the relevant section.

> **Status as of 2026-04-20:** Phase 1 vertical slice. Morning routine
> only, one-position cap, paper money.

---

## Design A — two-script Claude-Code invoker

The morning routine is split in two. **Neither script calls the
Anthropic SDK.** The decision comes from the Claude Code session that
the OpenClaw cron wakes up.

```
cron fires
  └─► npm run strategy:long-short:morning
        • preflight + bundle + pin in strat_runs (status='awaiting_decision')
        • exits with STRAT_RUN_ID=<uuid> on stdout
  └─► Claude Code reads the pinned bundle, reasons, produces decision JSON
  └─► npm run strategy:long-short:apply --run-id=<uuid> --decision-file=...
        • validates + constraints + order + writes + flips to status='ok'
```

`ANTHROPIC_API_KEY` is **not** needed on OpenClaw for either script.

---

## Quick reference

| Action | How |
|---|---|
| See last run's decision + writeup | https://longboard-ruddy.vercel.app/strategies/long-short |
| Pause the strategy | SQL: `update strategies set status = 'paused' where id = 'long-short';` |
| Unpause | `update strategies set status = 'live' where id = 'long-short';` |
| Stage a run manually | `npm run strategy:long-short:morning` (prints `STRAT_RUN_ID=<uuid>`) |
| Apply a decision | `npm run strategy:long-short:apply -- --run-id=<uuid> --decision-file=<path>` |
| Dry-stage (no writes) | `npm run strategy:long-short:morning -- --dry` |
| Dry-apply (no order/writes) | `npm run strategy:long-short:apply -- --run-id=<uuid> --decision-file=<path> --dry` |
| Smoke-test the reference Claude API path | `npm run strategy:long-short:smoke` (dev only; needs `ANTHROPIC_API_KEY` locally) |
| See last 5 runs | `select ran_at, status, error, (output->>'decision') as decision from strat_runs where strategy_id='long-short' order by ran_at desc limit 5;` |
| See pending decisions | `select id, ran_at, inputs->'pre_market_movers'->0->>'ticker' as first_mover from strat_runs where strategy_id='long-short' and status='awaiting_decision';` |
| Clear a stale awaiting_decision | `update strat_runs set status='error', error='abandoned' where id='<uuid>' and status='awaiting_decision';` |
| Slack channel | `#longboard-strategies` |

---

## strat_runs.status values

| Status | Meaning | Blocks new run today? |
|---|---|---|
| `awaiting_decision` | `:morning` pinned the bundle; Claude Code hasn't applied yet | yes |
| `running` | Legacy one-shot sentinel from pre-Design-A code. New runs don't use this. | yes |
| `ok` | Applied successfully (enter or skip) | yes |
| `error` | Any failure path | **no** — re-runs allowed |
| `skipped` | Idempotency or market-closed gate fired before work began | no |

---

## What the cron does

At **9:00 CT Mon–Fri**, OpenClaw wakes up the session-main Claude Code
with a system event. The event tells Claude Code to:

1. Run `npm run strategy:long-short:morning`. The script:
   - Pings Alpaca + Polygon + Exa + Finnhub. Aborts loud to Slack on any ping fail.
   - Checks idempotency — skips if today already has `ok` / `running` / `awaiting_decision`.
   - Checks market-open via Polygon `/v1/marketstatus/now` with a 2026 holiday fallback.
   - Assembles the bundle: Exa news (last 12h), Finnhub earnings (yesterday-AMC + today), Polygon pre-market movers.
   - Inserts a `strat_runs` row with `status='awaiting_decision'`, bundle in `inputs`, and `id` returned.
   - Posts Slack: "bundle pinned · N news · M earnings · P movers · awaiting decision".
   - Prints `STRAT_RUN_ID=<uuid>` on stdout and exits 0.

2. Claude Code reads the bundle from `strat_runs.inputs` (or stdout — both work), reasons about it, and produces a decision JSON that matches the contract in `lib/strategies/long-short/schema.ts`.

3. Claude Code invokes `npm run strategy:long-short:apply --run-id=<uuid> --decision-file=<path>`. The apply script:
   - Verifies the run is still `awaiting_decision`.
   - Validates the decision JSON.
   - On `skip`: writes the writeup to the run row, flips to `ok`, posts Slack skip message.
   - On `enter`: fetches last price (Polygon), enforces constraints (forbidden ticker, side=long, size 3–7%, stop<entry, book cap), sizes the order, places the Alpaca paper market order, writes `strat_positions` + `strat_trades`, flips the run to `ok`, posts Slack enter message.

The Slack channel shows three messages per live weekday: stage message + enter/skip/error message. `[DRY]` prefix is a test run.

---

## Installing the cron (one-time setup on OpenClaw)

### Prerequisites

Before installing the cron, make sure these are in OpenClaw's session
env (visible to `su - openclaw -s /bin/bash`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POLYGON_API_KEY`
- `EXA_API_KEY`
- `FINNHUB_API_KEY`
- `SLACK_STRATEGIES_WEBHOOK_URL`

`ANTHROPIC_API_KEY` is deliberately absent — neither script calls the
Anthropic SDK. The session-main Claude Code itself does the reasoning.

Also:

- Longboard repo cloned on the OpenClaw host; the `openclaw` user can
  `cd` into it.
- `npm install` run recently enough that `tsx` and deps are present.
- Supabase migrations applied through today (strategies/strat_* +
  user_broker_keys strategy-scope extension).
- Alpaca paper creds seeded in the vault for `strategy_id='long-short'`.

### The command

Longboard is cloned at `/home/openclaw/longboard` on OpenClaw (clone + `npm install` done as setup). The command uses that explicit path.

Pick the path that matches the shell you're in. `whoami` if unsure.

**If you are logged in as `root`** (and need to drop to the `openclaw` user):

```bash
su - openclaw -s /bin/bash -c 'openclaw cron add \
  --name "longboard-strat-long-short-morning" \
  --cron "0 9 * * 1-5" \
  --tz "America/Chicago" \
  --session main \
  --system-event "Run the Long/Short Portfolio morning routine. Three steps:
Step 1: cd /home/openclaw/longboard && npm run strategy:long-short:morning -- --invoker=claude-code
  Capture the STRAT_RUN_ID=<uuid> line from stdout. If the script exits non-zero or prints no STRAT_RUN_ID, stop and post the error to #longboard-strategies.
Step 2: Query the strat_runs row with that id (select inputs from strat_runs where id=<uuid>). The inputs column has today top_news, earnings_today, and pre_market_movers. Read it, reason about the best single long position for today per the spec at docs/strategies/long-short.md (or none), and produce a decision JSON matching lib/strategies/long-short/schema.ts.
Step 3: Write that JSON to /tmp/long-short-decision.json and run: cd /home/openclaw/longboard && npm run strategy:long-short:apply -- --run-id=<uuid> --decision-file=/tmp/long-short-decision.json
  If apply fails, the script will have already posted an error to #longboard-strategies. Do not duplicate."'
```

**If you are already logged in as the `openclaw` user** (Buddy's session, or an SSH session where you used `openclaw@` directly): drop the `su - openclaw -s /bin/bash -c '...'` wrapper and run the inner command directly. Running the wrapped version as `openclaw` fails with an authentication error because there's no root password to switch back through.

```bash
openclaw cron add \
  --name "longboard-strat-long-short-morning" \
  --cron "0 9 * * 1-5" \
  --tz "America/Chicago" \
  --session main \
  --system-event "Run the Long/Short Portfolio morning routine. Three steps:
Step 1: cd /home/openclaw/longboard && npm run strategy:long-short:morning -- --invoker=claude-code
  Capture the STRAT_RUN_ID=<uuid> line from stdout. If the script exits non-zero or prints no STRAT_RUN_ID, stop and post the error to #longboard-strategies.
Step 2: Query the strat_runs row with that id (select inputs from strat_runs where id=<uuid>). The inputs column has today top_news, earnings_today, and pre_market_movers. Read it, reason about the best single long position for today per the spec at docs/strategies/long-short.md (or none), and produce a decision JSON matching lib/strategies/long-short/schema.ts.
Step 3: Write that JSON to /tmp/long-short-decision.json and run: cd /home/openclaw/longboard && npm run strategy:long-short:apply -- --run-id=<uuid> --decision-file=/tmp/long-short-decision.json
  If apply fails, the script will have already posted an error to #longboard-strategies. Do not duplicate."
```

Key flags (do not change without reading OpenClaw's cron docs):

- `--cron` — the schedule flag. **Not** `--schedule` (different CLI tool's convention; OpenClaw's is `--cron`).
- `--session main` — critical. Without this, cron runs in an isolated session with no secrets / memory.
- `--system-event` — daemon interprets this as a Claude-Code event, using the daemon's configured model.
- `--tz "America/Chicago"` — OpenClaw handles DST, you don't compute UTC offsets.

### Verifying install

As root:
```bash
su - openclaw -s /bin/bash -c 'openclaw cron list' | grep long-short
```

As `openclaw`:
```bash
openclaw cron list | grep long-short
```

### Deleting the cron

**Delete by job id, not name.**

As root:
```bash
su - openclaw -s /bin/bash -c 'openclaw cron list'   # find the id
su - openclaw -s /bin/bash -c 'openclaw cron delete <id>'
```

As `openclaw`:
```bash
openclaw cron list               # find the id
openclaw cron delete <id>
```

---

## How to pause the strategy

### Soft pause

```sql
update strategies set status = 'paused' where id = 'long-short';
```

No code consults `strategies.status` on the cron path today — this
only changes the UI (card moves off the LIVE rack). To actually
stop the cron, either also delete it (below), or ship a Phase 2
check that reads `strategies.status` before staging.

### Hard pause

Delete the OpenClaw cron per above. To resume, re-run the install.

---

## How to check the last run

### Web

https://longboard-ruddy.vercel.app/strategies/long-short (admin-gated).
The page now surfaces four states:

- **`ok`** — writeup renders, decision badge (ENTER / SKIP)
- **`awaiting_decision`** — amber box: "bundle pinned, waiting for Claude Code to produce a decision"
- **`error`** — red box with the error prefix
- **`running`** (legacy) — amber box: "run in progress"

### SQL

```sql
select ran_at, status, error, (output->>'decision') as decision, (output->>'ticker') as ticker
from strat_runs where strategy_id='long-short'
order by ran_at desc limit 10;
```

Full writeup: `select writeup_md from strat_runs where id = '...';`
Full pinned bundle: `select inputs from strat_runs where id = '...';`

---

## How to manually trigger a run

### Live stage + apply

```bash
cd /path/to/longboard
npm run strategy:long-short:morning
# grep the STRAT_RUN_ID=<uuid> line from the output
# read the bundle, produce a decision.json somewhere
npm run strategy:long-short:apply -- --run-id=<uuid> --decision-file=<path>
```

### Dry (no writes, no orders, Slack tagged `[DRY]`)

```bash
npm run strategy:long-short:morning -- --dry
# decision-file for dry-apply doesn't need a real run id — the apply
# will reject with run_not_found, which is expected for dry testing
# of the staging path. To dry-test apply end-to-end, stage live first.
```

### Smoke (reference Anthropic API path only)

```bash
npm run strategy:long-short:smoke
```

Tests the validator + Slack path against a real Claude API call with a
mocked bundle. Not part of the production flow anymore — the cron's
Claude Code event is the real decision-maker — but useful for catching
prompt/validator drift. Needs `ANTHROPIC_API_KEY` in the *local*
environment (not OpenClaw).

---

## How to read the Slack output

### Stage

```
*Long/Short Portfolio — morning bundle pinned*
2 news · 56 earnings · 25 movers · run 58f06a12
Awaiting decision from Claude Code.
→ /strategies/long-short
```

### Apply: enter

```
*Long/Short Portfolio — morning run*
Bought CZR · 235 shares @ $27.62 · stop $24.50 · size 6.5%
Thesis: CZR presents an asymmetric risk/reward on the Fertitta takeover...
→ /strategies/long-short
```

### Apply: skip

```
*Long/Short Portfolio — morning run*
Declined to trade today. Bundle has no clean catalyst — earnings volatility...
→ /strategies/long-short
```

### Apply: error

```
:warning: *Long/Short Portfolio — morning run ERROR*
constraints_violated: stop_not_below_entry: stop 30.00 must be below entry 27.62 for a long
→ /strategies/long-short
```

### `[DRY]` or `[SMOKE]` prefix

Manual test run. No orders, no writes.

---

## Error glossary

Stable prefixes emitted by either script.

### From `:morning` (staging)

| Prefix | Meaning | First action |
|---|---|---|
| `missing env vars: X` | Env var unset on OpenClaw | Add to OpenClaw env; re-run |
| `preflight_failed: alpaca: ...` | Alpaca paper account ping failed | Alpaca status page; check vault creds |
| `preflight_failed: polygon: ...` | Polygon ping failed | Polygon status; verify `POLYGON_API_KEY` |
| `preflight_failed: exa: ...` | Exa search failed | Exa dashboard; rate limit or plan-tier |
| `preflight_failed: finnhub: ...` | Finnhub `/quote` failed | Finnhub dashboard |
| `today_run_lookup_failed: ...` | Supabase read failed | Supabase status |
| `awaiting_decision_insert_failed: ...` | Supabase insert failed | Supabase status |
| `bundle_failed: ...` | All bundle layers failed | Check vendor status; re-run dry |

### From `:apply`

| Prefix | Meaning | First action |
|---|---|---|
| `run_not_found: <uuid>` | Run id doesn't exist | Check you got the id right; staging may have been on a different day |
| `run_not_applicable: status='X'` | Run already applied or errored | Only `awaiting_decision` rows are applyable. Look at the run's status; typically means someone else already applied it |
| `decision_invalid: ...` | JSON violated the contract | Inspect the decision file; common: wrong type, out-of-range size, missing stop |
| `last_price_failed: ...` | Polygon snapshot for ticker returned no price | Ticker may be halted or delisted — choose a different one |
| `constraints_violated: forbidden_ticker: ...` | Decision picked a leveraged/inverse ETF | Update `docs/strategies/long-short.md` if the symbol keeps tripping it |
| `constraints_violated: stop_not_below_entry: ...` | Stop at or above current price for a long | Re-produce the decision with a valid stop |
| `constraints_violated: book_cap_exceeded: ...` | Already 1 open position (Phase 1 cap) | Close the existing position first, or wait for Phase 2 |
| `alpaca_account_failed: ...` | Alpaca /account call failed after preflight | Re-run apply |
| `alpaca_order_failed: ...` | Alpaca rejected the order | Check Slack for HTTP body; halted ticker, insufficient BP, or market closed |
| `qty_zero: ...` | Sizing produced zero shares | Usually a high-priced thin name; re-produce the decision |
| `persist_enter_failed: ... alpaca_order_id=X` | **Order live on Alpaca but DB partial.** Manual reconcile | Get `alpaca_order_id`, check Alpaca for fill, reconcile positions/trades rows |
| `PARTIAL WRITE: ...` | Same, prefix on the Slack variant | Same |

### Stranded `awaiting_decision`

If Claude Code crashes or times out between `:morning` and `:apply`,
the run sits at `awaiting_decision` forever. Tomorrow's fire will be
unblocked (different ET date), but today's re-stage will be blocked.

To clear:

```sql
update strat_runs set status = 'error', error = 'abandoned'
where id = '<uuid>' and status = 'awaiting_decision';
```

Then re-run `:morning` if you want to try again today.

---

## Phase 1 limitations (read once)

- **One position, ever.** Apply refuses to place a second order while any position is open.
- **No end-of-day monitor.** Stops live in `strat_positions.stop_price` but aren't sent as bracket orders. Manual exits or Phase 2's EOD routine.
- **No Friday review.** Phase 2 adds the 3:30 CT weekly.
- **Shorts forbidden.** Schema + validator + constraint all reject `side: 'short'`.
- **Econ calendar not in the bundle.** Deferred from Phase 1 per audit Q4.

---

## Phase 1 success criteria

From the handoff:

1. ☐ Cron fires on three consecutive weekdays without manual intervention.
2. ☐ Each run posts to Slack within 90 seconds of starting (stage + apply = 2 posts per run).
3. ☐ Every run is visible on `/strategies/long-short` with readable rationale.
4. ☐ At least one `enter` decision.
5. ☐ No zombie rows.
6. ☐ Runbook reads cleanly Monday morning.
