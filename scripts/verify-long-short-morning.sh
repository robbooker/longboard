#!/usr/bin/env bash
# Long/Short Portfolio — morning cron verifier on OpenClaw.
#
# Runs 10 minutes after the main morning cron (9:10 AM CT weekdays).
# Diagnoses only — never attempts fixes, never touches strat_runs,
# never restarts anything. Posts one status line per fire to the
# strategies Slack webhook.
#
# Context: Apr 22 + Apr 23 fires both silently died at `claude:
# command not found` (root-caused in commit f3d7067: plain cron's
# minimal PATH didn't include ~/.local/bin). This verifier exists
# so the next silent failure is noisy within 10 minutes instead of
# discovered on the next manual check.
#
# Crontab entry (install manually under the openclaw user):
#   10 9 * * 1-5 /home/openclaw/longboard/scripts/verify-long-short-morning.sh \
#     >> /home/openclaw/logs/verify-long-short-morning.log 2>&1

set -euo pipefail

# Same PATH export as the main cron. Today's verify only uses /usr/bin
# tools (curl, grep, awk, jq), but keeping parity avoids future
# surprises if we add a ~/.local/bin-installed CLI later.
export PATH="/home/openclaw/.local/bin:$PATH"

LOG_PREFIX="[verify-long-short][$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
log() { echo "${LOG_PREFIX} $*"; }
err() { echo "${LOG_PREFIX} ERROR: $*" >&2; }

MAIN_LOG="/home/openclaw/logs/longboard-long-short-morning.log"
SECRETS_FILE="/home/openclaw/.openclaw/workspace/.secrets"

# ── 1. Secrets ──────────────────────────────────────────────────────
if [[ ! -r "$SECRETS_FILE" ]]; then
  err "secrets file not readable: $SECRETS_FILE"
  exit 1
fi
# set -a auto-exports — matches the pattern in run-long-short-morning.sh
# so KEY=VALUE and `export KEY=VALUE` lines both propagate.
set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

for v in SLACK_STRATEGIES_WEBHOOK_URL NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  if [[ -z "${!v:-}" ]]; then
    err "$v not set after sourcing secrets"
    exit 1
  fi
done

# ── 2. Slack helper ─────────────────────────────────────────────────
# 30s wall-clock bound so a Slack outage can't hang the verifier.
# Failure to post is logged but non-fatal — the verifier's own log
# file is the authoritative trace regardless.
slack_post() {
  local text="$1"
  local payload
  payload=$(jq -n --arg t "$text" '{text: $t}')
  if ! curl --max-time 30 --silent --show-error --fail \
    --request POST \
    --header "Content-Type: application/json" \
    --data "$payload" \
    "$SLACK_STRATEGIES_WEBHOOK_URL" >/dev/null; then
    err "slack post failed (continuing)"
  fi
}

# ── 3. Locate today's run block in the main log ─────────────────────
if [[ ! -r "$MAIN_LOG" ]]; then
  err "main log not readable: $MAIN_LOG"
  slack_post ":warning: Long/Short verify: main log unreadable at $MAIN_LOG"
  exit 1
fi

TODAY_UTC=$(date -u +%Y-%m-%d)

# Each run emits `cwd /home/openclaw/longboard · git <sha>` at line 64
# of run-long-short-morning.sh. That's the start-of-run marker. Find
# the line number of the most recent one.
LAST_CWD_LINE=$(grep -nE "cwd /home/openclaw/longboard" "$MAIN_LOG" | tail -1 || true)

if [[ -z "$LAST_CWD_LINE" ]]; then
  err "no 'cwd /home/openclaw/longboard' marker found in main log"
  slack_post ":warning: Long/Short verify: no run marker in main log — cron may not have fired"
  exit 0
fi

LAST_CWD_LINENO=${LAST_CWD_LINE%%:*}
# Timestamp lives inside `[long-short][2026-04-23T14:00:01Z]` on the
# marker line itself. Pull the YYYY-MM-DD out.
LAST_CWD_DATE=$(echo "$LAST_CWD_LINE" | grep -oE '\[[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 | tr -d '[')

if [[ "$LAST_CWD_DATE" != "$TODAY_UTC" ]]; then
  err "most recent run marker is $LAST_CWD_DATE, not today ($TODAY_UTC)"
  slack_post ":warning: Long/Short verify: no run found in today's log — cron may not have fired (last run: $LAST_CWD_DATE)"
  exit 0
fi

# Today's run block = everything from the marker line to EOF.
RUN_BLOCK=$(tail -n +"$LAST_CWD_LINENO" "$MAIN_LOG")

# ── 4. Extract STRAT_RUN_ID ─────────────────────────────────────────
# Stage echoes `STRAT_RUN_ID=<uuid>` to stdout; run-long-short-morning.sh
# passes that through to the log at line 70.
RUN_ID=$(echo "$RUN_BLOCK" | grep -oE 'STRAT_RUN_ID=[a-f0-9-]+' | head -1 | cut -d= -f2 || true)

if [[ -z "$RUN_ID" ]]; then
  # Legitimate skip (market closed, idempotency, holiday) emits a
  # specific log line. Silent on that case — no Slack spam on a
  # normal Monday-after-a-holiday-Friday.
  if echo "$RUN_BLOCK" | grep -q "stage skipped (no STRAT_RUN_ID emitted)"; then
    log "stage skipped for today — no verification needed"
    exit 0
  fi
  err "run started but no STRAT_RUN_ID emitted — stage may have crashed"
  LAST_50=$(echo "$RUN_BLOCK" | tail -50)
  slack_post ":rotating_light: Long/Short verify: run started but no STRAT_RUN_ID — stage may have crashed

\`\`\`
$LAST_50
\`\`\`"
  exit 0
fi

log "found run_id=$RUN_ID"

# ── 5. Query Supabase for this strat_runs row ───────────────────────
# REST API + service-role key. 30s timeout so Supabase downtime can't
# hang the verifier. Quoting the URL to keep jq-style ? and = safe.
SB_URL="${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/strat_runs?id=eq.${RUN_ID}&select=status,error,output"

set +e
SB_RESPONSE=$(curl --max-time 30 --silent --show-error \
  --header "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  --header "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  "$SB_URL")
SB_CURL_EXIT=$?
set -e

if [[ $SB_CURL_EXIT -ne 0 ]]; then
  err "supabase curl failed (exit $SB_CURL_EXIT)"
  slack_post ":warning: Long/Short verify: $RUN_ID — Supabase query failed (curl exit $SB_CURL_EXIT)"
  exit 0
fi

SB_ROW=$(echo "$SB_RESPONSE" | jq -r '.[0] // empty' 2>/dev/null || echo "")
if [[ -z "$SB_ROW" ]]; then
  err "strat_runs row not found for id=$RUN_ID (response: $SB_RESPONSE)"
  slack_post ":warning: Long/Short verify: $RUN_ID — row not found in strat_runs (DB write failed?)"
  exit 0
fi

SB_STATUS=$(echo "$SB_ROW" | jq -r '.status // "null"')
SB_ERROR=$(echo "$SB_ROW" | jq -r '.error // "null"')
SB_OUTPUT_NULL=$(echo "$SB_ROW" | jq -r 'if .output == null then "true" else "false" end')

log "db: status=$SB_STATUS output_null=$SB_OUTPUT_NULL error=$SB_ERROR"

# ── 6. Log-state signals ────────────────────────────────────────────
LOG_APPLY_OK=false
LOG_CLAUDE_OK=false
LOG_CLAUDE_NOT_FOUND=false
LOG_CLAUDE_TIMEOUT=false

if echo "$RUN_BLOCK" | grep -q "apply ok · cron cycle complete"; then LOG_APPLY_OK=true; fi
if echo "$RUN_BLOCK" | grep -q "claude ok · decision=";          then LOG_CLAUDE_OK=true; fi
if echo "$RUN_BLOCK" | grep -q "claude: command not found";      then LOG_CLAUDE_NOT_FOUND=true; fi
if echo "$RUN_BLOCK" | grep -q "claude timed out after 120s";    then LOG_CLAUDE_TIMEOUT=true; fi

# "claude exited N" for any other nonzero exit (may also be present
# alongside command-not-found / timeout — those branches match first).
LOG_CLAUDE_EXIT=$(echo "$RUN_BLOCK" | grep -oE 'claude exited [0-9]+' | tail -1 | awk '{print $3}' || true)

# Apply's "done: {...}" line carries the decision verb (enter|skip).
# Prefer that; fall back to "<decision>" placeholder if not present.
DECISION=$(echo "$RUN_BLOCK" | grep -oE "decision: '(enter|skip)'" | tail -1 | sed -E "s/.*'([^']+)'/\1/" || true)
DECISION=${DECISION:-"<unknown>"}

LAST_20=$(echo "$RUN_BLOCK" | tail -20)
LAST_30=$(echo "$RUN_BLOCK" | tail -30)

# ── 7. Decision tree ────────────────────────────────────────────────
# Ordered most-scary → least-scary. claude-level failures come first
# because a silent `command not found` is the exact scenario this
# verifier was built to catch.
if [[ "$LOG_CLAUDE_NOT_FOUND" == true ]]; then
  slack_post ":rotating_light: Long/Short verify: $RUN_ID — claude invocation failed — command not found

\`\`\`
$LAST_30
\`\`\`"
elif [[ "$LOG_CLAUDE_TIMEOUT" == true ]]; then
  slack_post ":rotating_light: Long/Short verify: $RUN_ID — claude invocation failed — timeout (exit 124)

\`\`\`
$LAST_30
\`\`\`"
elif [[ -n "$LOG_CLAUDE_EXIT" && "$LOG_CLAUDE_EXIT" != "0" ]]; then
  slack_post ":rotating_light: Long/Short verify: $RUN_ID — claude invocation failed — exit $LOG_CLAUDE_EXIT

\`\`\`
$LAST_30
\`\`\`"
elif [[ "$LOG_APPLY_OK" == true && "$SB_STATUS" != "awaiting_decision" && "$SB_STATUS" != "error" ]]; then
  slack_post ":white_check_mark: Long/Short verify: $RUN_ID $DECISION — pipeline green"
elif [[ "$LOG_CLAUDE_OK" == true && ( "$SB_STATUS" == "error" || "$LOG_APPLY_OK" != true ) ]]; then
  slack_post ":warning: Long/Short verify: $RUN_ID apply step failed — ${SB_ERROR}"
elif [[ "$SB_STATUS" == "awaiting_decision" ]]; then
  slack_post ":warning: Long/Short verify: $RUN_ID stuck at awaiting_decision — check manually

\`\`\`
$LAST_20
\`\`\`"
else
  slack_post ":warning: Long/Short verify: $RUN_ID unclassified state · apply_ok=$LOG_APPLY_OK claude_ok=$LOG_CLAUDE_OK db_status=$SB_STATUS db_error=$SB_ERROR

\`\`\`
$LAST_20
\`\`\`"
fi

log "verify complete"
