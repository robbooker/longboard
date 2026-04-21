# Long/Short Portfolio — runbook

Written for 7 a.m. Monday, when the cron misfired and you have coffee
in one hand. Skim the quick reference, then read the relevant section.

> **Status as of 2026-04-21:** Phase 1 vertical slice. Morning routine
> only, one-position cap, paper money. Cron switched today from the
> OpenClaw daemon's `sessionTarget:"main"` + `--system-event` pattern
> (which was skipped at the harness layer on today's 9:00 fire) to
> plain Linux cron + `claude -p --bare --model opus` CLI driven by
> `scripts/run-long-short-morning.sh`.

---

## Design A — shell-driven Claude CLI invoker

The morning routine is a shell script on OpenClaw that drives two
npm scripts with a `claude -p --bare` one-shot in between. The
original plan — OpenClaw daemon's `sessionTarget:"main"` + system
event — was skipped at the harness layer on Apr 21 because the
config OpenClaw runs uses dedicated-cron heartbeats, not the main
session. So we're on plain Linux cron instead.

```
plain cron fires (openclaw user, 9:00 CT Mon–Fri)
  └─► /home/openclaw/longboard/scripts/run-long-short-morning.sh
        │
        ├─► source /home/openclaw/.openclaw/workspace/.secrets
        │   (includes ANTHROPIC_API_KEY for `claude --bare` auth)
        │
        ├─► npm run strategy:long-short:morning --invoker=claude-code
        │     • preflight + bundle + pin strat_runs (awaiting_decision)
        │     • writes bundle to /tmp/long-short-bundle-<runId>.json
        │     • emits STRAT_RUN_ID + STRAT_BUNDLE_FILE on stdout
        │
        ├─► claude -p --bare --model opus \
        │       --system-prompt-file docs/strategies/long-short.md \
        │       < <prompt with bundle>  > /tmp/long-short-decision-<runId>.json
        │
        └─► npm run strategy:long-short:apply
              • validates + constraints + Alpaca order + DB writes
              • flips run row to ok (or error)
              • Slack posts from the TS module
```

`ANTHROPIC_API_KEY` IS needed on OpenClaw under this design — it
authenticates the `claude --bare` CLI call. The two npm scripts
still don't call Anthropic directly; the CLI is the one caller.

**Why `--bare`?** No CLAUDE.md auto-discovery, no auto-memory, no
hooks, no keychain/OAuth — strict ANTHROPIC_API_KEY auth. The
decision context is the strategy spec ONLY. Deterministic.

**Why Opus?** Mandate is "trade on current events, do not lose a
lot when wrong" — a nuanced-reasoning task where the Opus tier
earns its keep. Once-a-day frequency makes the cost delta vs
Sonnet negligible.

---

## Quick reference

| Action | How |
|---|---|
| See last run's decision + writeup | https://longboardai.com/strategies/long-short |
| Pause the strategy | SQL: `update strategies set status = 'paused' where id = 'long-short';` |
| Unpause | `update strategies set status = 'live' where id = 'long-short';` |
| Trigger the full cron cycle manually | `/home/openclaw/longboard/scripts/run-long-short-morning.sh` |
| Stage only (no Claude, no apply) | `npm run strategy:long-short:morning` (prints `STRAT_RUN_ID=<uuid>` + `STRAT_BUNDLE_FILE=<path>`) |
| Apply a decision you wrote yourself | `npm run strategy:long-short:apply -- --run-id=<uuid> --decision-file=<path>` |
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

At **9:00 CT Mon–Fri**, the `openclaw` user's crontab fires
`/home/openclaw/longboard/scripts/run-long-short-morning.sh`. The
shell script:

1. Sources `/home/openclaw/.openclaw/workspace/.secrets` (and
   `set -a` auto-exports everything so child processes inherit
   `ANTHROPIC_API_KEY` et al).

2. `cd /home/openclaw/longboard`.

3. Runs `npm run strategy:long-short:morning -- --invoker=claude-code`.
   The stage script:
   - Pings Alpaca + Polygon + Exa + Finnhub. Aborts loud to Slack on any ping fail.
   - Checks idempotency — skips if today already has `ok` / `running` / `awaiting_decision`.
   - Checks market-open via Polygon `/v1/marketstatus/now` with a 2026 holiday fallback.
   - Assembles the bundle: Exa news (last 12h), Finnhub earnings (yesterday-AMC + today), Polygon pre-market movers.
   - Inserts a `strat_runs` row with `status='awaiting_decision'`, bundle in `inputs`.
   - **Writes the bundle to `/tmp/long-short-bundle-<runId>.json`** so the shell can feed it to the next step without a second Supabase query.
   - Posts Slack: "bundle pinned · N news · M earnings · P movers · awaiting decision".
   - Prints `STRAT_RUN_ID=<uuid>` + `STRAT_BUNDLE_FILE=<path>` on stdout.

4. Shell builds a user prompt concatenating the bundle JSON with an
   instruction to respond with contract-matching JSON, then pipes
   it to:

   ```bash
   claude -p \
     --bare \
     --no-session-persistence \
     --output-format=text \
     --model opus \
     --max-budget-usd 0.75 \
     --system-prompt-file docs/strategies/long-short.md \
     < prompt  > /tmp/long-short-decision-<runId>.json
   ```

5. Runs `npm run strategy:long-short:apply -- --run-id=<uuid> --decision-file=/tmp/long-short-decision-<uuid>.json`.
   The apply script:
   - Verifies the run is still `awaiting_decision`.
   - Validates the decision JSON against the contract.
   - On `skip`: writes writeup to the run row, flips to `ok`, posts Slack skip message.
   - On `enter`: fetches last price (Polygon), enforces constraints (forbidden ticker, side=long, size 3–7%, stop<entry, book cap), sizes the order, places the Alpaca paper market order, writes `strat_positions` + `strat_trades`, flips the run to `ok`, posts Slack enter message.

The Slack channel shows two messages per live weekday: stage
message + enter/skip/error message. `[DRY]` prefix is a test run.
`:warning:` prefix is an error path; run row also flipped to
`error`.

Shell script always exits 0 on any "clean" outcome (skip, enter,
apply-error-with-Slack-post). It only exits non-zero when the
shell itself fails — secrets missing, npm crash, claude CLI
crash, etc. This way cron doesn't generate spurious mail when the
strategy legitimately skips or decides-and-errors.

Tmp files (prompt, bundle, decision) are keyed on the run id and
left on disk for post-mortem. `/tmp` gets cleaned on reboot.

---

## Installing the cron (one-time setup on OpenClaw)

### Prerequisites

These must be in `/home/openclaw/.openclaw/workspace/.secrets`
(the shell script sources this file and `set -a` auto-exports
everything, so plain `KEY=VALUE` or `export KEY=VALUE` both work):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POLYGON_API_KEY`
- `EXA_API_KEY`
- `FINNHUB_API_KEY`
- `SLACK_STRATEGIES_WEBHOOK_URL`
- `ANTHROPIC_API_KEY` — **required** under this design. Authenticates
  the `claude --bare` call. `--bare` does not read keychain or OAuth,
  only this env var (or an `apiKeyHelper` via `--settings`).

Also:

- Longboard repo cloned at `/home/openclaw/longboard`.
- `npm install` run recently enough that `tsx` and deps are present.
- `claude` CLI installed and on the `openclaw` user's PATH. Check
  with `su - openclaw -c 'which claude'`.
- The `scripts/run-long-short-morning.sh` file in the repo is
  executable (`chmod +x` — git preserves the bit).
- `/var/log/longboard-long-short-morning.log` writable by the
  `openclaw` user (create with `sudo touch … && sudo chown openclaw:openclaw …`
  if the user can't create it in `/var/log/` directly).
- Supabase migrations applied through today (strategies/strat_* +
  user_broker_keys strategy-scope extension).
- Alpaca paper creds seeded in the vault for `strategy_id='long-short'`.

### Step 1: Remove the old OpenClaw-daemon cron

The Apr 20 install used the daemon's `openclaw cron add --session main
--system-event ...` pattern. That pattern doesn't fire on this host
(skipped at the harness layer on Apr 21's first scheduled run). Delete it:

```bash
su - openclaw -s /bin/bash -c 'openclaw cron delete 7033a1eb-048e-4a9a-8db2-6128cf226df8'
```

Confirm it's gone:

```bash
su - openclaw -s /bin/bash -c 'openclaw cron list' | grep long-short
# (should return no matches)
```

### Step 2: Install the plain Linux cron entry

As the `openclaw` user (either `su - openclaw` or SSH as `openclaw`),
open the crontab:

```bash
crontab -e
```

Add this line:

```cron
0 9 * * 1-5 /home/openclaw/longboard/scripts/run-long-short-morning.sh >> /var/log/longboard-long-short-morning.log 2>&1
```

That's `0 9 * * 1-5` — at 09:00 every Mon–Fri. The cron daemon
uses the system timezone. If `timedatectl` shows anything other
than America/Chicago, either set the system TZ or change the
schedule to the UTC equivalent (14:00 UTC during CDT, 15:00 UTC
during CST; set `CRON_TZ=America/Chicago` at the top of the
crontab for a cleaner DST story).

### Step 3: Verify install

As `openclaw`:

```bash
crontab -l | grep long-short
```

Should show exactly the line you added.

Manually trigger the script once to confirm the plumbing works
(secrets readable, repo present, `claude` on PATH, npm scripts
wired, log writable):

```bash
/home/openclaw/longboard/scripts/run-long-short-morning.sh
tail -50 /var/log/longboard-long-short-morning.log
```

Expected log shape (if market is open):
```
[long-short][…] cwd /home/openclaw/longboard · git <sha>
[long-short][…] stage: running strategy:long-short:morning
[stage output with STRAT_RUN_ID + STRAT_BUNDLE_FILE]
[long-short][…] stage ok · run_id=… · bundle=/tmp/long-short-bundle-…json
[long-short][…] claude: invoking with --bare --model opus
[long-short][…] claude ok · decision=/tmp/long-short-decision-….json · bytes=2400
[long-short][…] apply: running strategy:long-short:apply
[apply output]
[long-short][…] apply ok · cron cycle complete
```

Expected if market is closed (weekend / holiday): stage logs
"skipping: market closed" and shell exits 0 with no further steps.

Expected if today already has an `ok`/`running`/`awaiting_decision`
row: stage logs "skipping: already ran today successfully" (or the
in-progress variant) and shell exits 0.

### Deleting the cron

As `openclaw`:

```bash
crontab -e
# remove the line, save, exit
```

Or to preserve it while disabling:

```bash
crontab -e
# prefix the line with `#`
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

https://longboardai.com/strategies/long-short (admin-gated).
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

### Full cycle via the shell script (OpenClaw)

Mirrors exactly what the cron does:

```bash
ssh openclaw@...
/home/openclaw/longboard/scripts/run-long-short-morning.sh
tail -50 /var/log/longboard-long-short-morning.log
```

All three phases run: stage → claude → apply. `claude --bare` uses
`ANTHROPIC_API_KEY` from the sourced secrets. Real Alpaca order if
the decision is `enter`. Idempotency will refuse to fire if today
already has an `ok` / `running` / `awaiting_decision` row.

### Stage only, hand-crafted decision, apply (dev laptop)

Useful when you want to produce the decision yourself instead of
letting Claude:

```bash
cd /path/to/longboard
npm run strategy:long-short:morning      # get STRAT_RUN_ID + STRAT_BUNDLE_FILE
# craft /tmp/my-decision.json matching lib/strategies/long-short/schema.ts
npm run strategy:long-short:apply -- --run-id=<uuid> --decision-file=/tmp/my-decision.json
```

### Dry stage (no writes, no orders, Slack tagged `[DRY]`)

```bash
npm run strategy:long-short:morning -- --dry
```

Dry skips the DB insert, so no `STRAT_RUN_ID` is emitted. Apply
can't hook onto it. Useful for confirming preflight pings +
bundle assembly without side effects.

### Dry apply (validate + enforce constraints without placing an order)

```bash
npm run strategy:long-short:apply -- --run-id=<real-live-run-id> --decision-file=... --dry
```

Requires a real `awaiting_decision` row in the DB (stage it live
first). Skips the Alpaca POST and skips the `strat_positions` /
`strat_trades` inserts, but still validates + constraint-checks
the decision.

### Smoke (reference Anthropic API path only, dev-only)

```bash
npm run strategy:long-short:smoke
```

Tests the validator + Slack path against a real Claude API call
with a mocked bundle. **Not part of the production flow** — prod
uses the `claude -p --bare` CLI, not the SDK. But useful locally
for catching prompt/validator drift. Needs `ANTHROPIC_API_KEY` in
the *local* environment.

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
