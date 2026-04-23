#!/usr/bin/env bash
# Long/Short Portfolio — morning cron driver on OpenClaw.
#
# Invoked from a plain Linux crontab entry under the `openclaw` user:
#   0 9 * * 1-5 /home/openclaw/longboard/scripts/run-long-short-morning.sh \
#     >> /home/openclaw/logs/longboard-long-short-morning.log 2>&1
#
# Flow:
#   1. Source /home/openclaw/.openclaw/workspace/.secrets (env vars
#      including ANTHROPIC_API_KEY for `claude --bare` auth).
#   2. cd to the repo.
#   3. npm run strategy:long-short:morning — stages the research
#      bundle in Supabase, emits STRAT_RUN_ID + STRAT_BUNDLE_FILE
#      on stdout and writes the bundle JSON to /tmp.
#   4. Compose the user prompt (bundle + instruction to produce
#      contract-matching JSON) and pipe to `claude -p --bare` with
#      the strategy spec loaded as system prompt. Opus model.
#      Decision JSON lands in /tmp.
#   5. npm run strategy:long-short:apply — validates, places the
#      Alpaca order, writes positions + trades, flips the run row
#      to 'ok'. Slack posts handled by the TS module.
#
# Exits 0 on clean skip (market closed, idempotency), clean enter,
# or clean apply-error (the TS module already posted a :warning: to
# Slack; cron log is the trace). Exits non-zero only when the shell
# itself fails (secrets file missing, npm crash, etc.).

set -euo pipefail

# Plain Linux cron runs with a minimal PATH (typically /usr/bin:/bin)
# that does not include ~/.local/bin where the `claude` CLI lives for
# the openclaw user. Interactive shells pick it up via .bashrc; cron
# does not. Apr 22 + Apr 23 fires both died at `claude: command not
# found` (exit 127) because of this. Prepend .local/bin so cron + the
# manual-invoke path both resolve `claude` the same way.
export PATH="/home/openclaw/.local/bin:$PATH"

LOG_PREFIX="[long-short][$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
log() { echo "${LOG_PREFIX} $*"; }
err() { echo "${LOG_PREFIX} ERROR: $*" >&2; }

# ── 1. Secrets ────────────────────────────────────────────────────
SECRETS_FILE="/home/openclaw/.openclaw/workspace/.secrets"
if [[ ! -r "$SECRETS_FILE" ]]; then
  err "secrets file not readable: $SECRETS_FILE"
  exit 1
fi
# set -a auto-exports anything defined during the source, so child
# processes (npm, claude) inherit the vars whether the file uses
# `export` prefixes or plain KEY=VALUE lines.
set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  err "ANTHROPIC_API_KEY not set after sourcing secrets — claude --bare cannot authenticate"
  exit 1
fi

# ── 2. Repo ───────────────────────────────────────────────────────
REPO_DIR="/home/openclaw/longboard"
cd "$REPO_DIR"
log "cwd $(pwd) · git $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

# ── 3. Stage (bundle + pin + bundle file emit) ────────────────────
log "stage: running strategy:long-short:morning"
STAGE_OUT=$(npm run --silent strategy:long-short:morning -- --invoker=claude-code 2>&1)
STAGE_EXIT=$?
echo "$STAGE_OUT"

if [[ $STAGE_EXIT -ne 0 ]]; then
  err "stage exited non-zero (${STAGE_EXIT}); aborting"
  exit "$STAGE_EXIT"
fi

RUN_ID=$(echo "$STAGE_OUT" | grep -oE 'STRAT_RUN_ID=[a-f0-9-]+' | head -1 | cut -d= -f2 || true)
BUNDLE_FILE=$(echo "$STAGE_OUT" | grep -oE 'STRAT_BUNDLE_FILE=\S+' | head -1 | cut -d= -f2 || true)

# No run id → stage decided to skip (market closed, idempotency,
# holiday). Stage already logged the reason. Exit clean.
if [[ -z "$RUN_ID" ]]; then
  log "stage skipped (no STRAT_RUN_ID emitted); exiting clean"
  exit 0
fi

log "stage ok · run_id=${RUN_ID} · bundle=${BUNDLE_FILE:-<missing>}"

if [[ -z "$BUNDLE_FILE" || ! -s "$BUNDLE_FILE" ]]; then
  err "bundle file not written or empty: ${BUNDLE_FILE:-<not emitted>}"
  exit 1
fi

# ── 4. Build the user prompt + invoke claude ──────────────────────
PROMPT_FILE=$(mktemp "/tmp/long-short-prompt-${RUN_ID}.XXXXXX")
DECISION_FILE="/tmp/long-short-decision-${RUN_ID}.json"

{
  echo "Morning research bundle for today (JSON):"
  echo
  cat "$BUNDLE_FILE"
  echo
  echo "=== INSTRUCTION ==="
  echo "Based on the bundle above and the full spec in your system prompt,"
  echo "produce exactly one trade decision for today (or zero — 'skip' is"
  echo "valid). Respond with ONLY a single JSON object matching the contract"
  echo "described in the spec. No prose before or after. No markdown fences."
  echo "Just JSON."
} > "$PROMPT_FILE"

log "claude: invoking with --bare --model claude-opus-4-7"
# --bare: no hooks, no CLAUDE.md auto-discovery, no keychain/OAuth
#         — strict ANTHROPIC_API_KEY auth. Isolated decision context.
# --no-session-persistence: don't write this to the session store.
# --output-format=text: raw model output (which IS the JSON we want).
# --model claude-opus-4-7: explicit version pin. Reproducibility
#         matters more than forward-compat for a financial-decision
#         surface. Bumping the model is a deliberate, QA'd commit —
#         not a silent drift when Anthropic ships a new Opus.
# --max-budget-usd 0.75: safety cap. Typical Opus call at our payload
#         size is well under $0.25; anything higher is a prompt bug.
# Prompt comes in via stdin so we don't have to shell-escape JSON.
set +e
# timeout 120: wall-clock bound. Without it, a hung claude (auth
# revalidation, network stall, model stuck on a long generation) would
# block the entire cron cycle until the next day's run, silently. 120s
# is well above Opus's typical 20-40s response time for this payload;
# anything longer is a hang we want surfaced loudly via exit 124.
timeout 120 claude -p \
  --bare \
  --no-session-persistence \
  --output-format=text \
  --model claude-opus-4-7 \
  --max-budget-usd 0.75 \
  --system-prompt-file "${REPO_DIR}/docs/strategies/long-short.md" \
  < "$PROMPT_FILE" \
  > "$DECISION_FILE"
CLAUDE_EXIT=$?
set -e

if [[ $CLAUDE_EXIT -eq 124 ]]; then
  err "claude timed out after 120s (wall-clock bound hit — hang at auth, network, or generation)"
  cat "$DECISION_FILE" >&2 || true
  exit 124
fi
if [[ $CLAUDE_EXIT -ne 0 ]]; then
  err "claude exited ${CLAUDE_EXIT}; decision file may be empty"
  cat "$DECISION_FILE" >&2 || true
  exit "$CLAUDE_EXIT"
fi

if [[ ! -s "$DECISION_FILE" ]]; then
  err "claude produced empty output"
  exit 1
fi

log "claude ok · decision=${DECISION_FILE} · bytes=$(wc -c < "$DECISION_FILE")"

# ── 5. Apply ──────────────────────────────────────────────────────
log "apply: running strategy:long-short:apply"
set +e
npm run --silent strategy:long-short:apply -- \
  --run-id="$RUN_ID" \
  --decision-file="$DECISION_FILE"
APPLY_EXIT=$?
set -e

if [[ $APPLY_EXIT -ne 0 ]]; then
  # Apply already posted a :warning: to Slack and updated the run
  # row to status='error'. Don't escalate; the log is the trace.
  log "apply exited ${APPLY_EXIT} (non-fatal — Slack + DB already updated)"
  exit 0
fi

log "apply ok · cron cycle complete"

# Intentionally leave PROMPT_FILE, BUNDLE_FILE, DECISION_FILE on disk
# for post-mortem. Files are keyed on the run id so they don't
# collide across days. /tmp is cleaned on reboot.
