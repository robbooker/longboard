// CLI entry point — staging half of the Long/Short Portfolio morning
// routine (Design A, Claude-Code-invoker). Pins the research bundle
// in a strat_runs row with status='awaiting_decision' and exits.
//
// After this exits cleanly, the surrounding Claude Code session reads
// the pinned bundle (from strat_runs.inputs), reasons about it,
// produces a decision JSON matching the contract, and calls:
//   npm run strategy:long-short:apply -- --run-id=<id> --decision-file=<path>
//
// Local:    npm run strategy:long-short:morning [-- --dry]
// OpenClaw: env vars injected by the session; --env-file flag is a no-op
//           when .env.local isn't present.
//
// On success the script prints a `STRAT_RUN_ID=<uuid>` line — the
// cron system-event wording tells Claude Code to grep for that.

import { stageMorningRun } from "@/lib/strategies/long-short/morning-run";

const args = new Set(process.argv.slice(2));
const dry = args.has("--dry");

// --invoker=<x> is accepted for compatibility with the cron system-event
// wording, but stage doesn't branch on it — neither mode calls the
// Anthropic API on this path. Kept as a tag only.
const invoker = process.argv.slice(2).find((a) => a.startsWith("--invoker="))?.slice(10) ?? "claude-code";

async function main() {
  console.log(`[strategy:long-short:morning] starting${dry ? " (dry)" : ""} invoker=${invoker}`);
  const result = await stageMorningRun({ dry });
  console.log(`[strategy:long-short:morning] done:`, {
    status: result.status,
    reason: result.reason ?? null,
    error: result.error ?? null,
    runId: result.runId ?? null,
    dry: result.dry,
    bundle_summary: result.bundle
      ? {
          top_news: result.bundle.top_news.length,
          earnings_today: result.bundle.earnings_today.length,
          pre_market_movers: result.bundle.pre_market_movers.length,
          layer_errors: result.bundle.errors.length,
        }
      : null,
  });

  // Prominent, greppable marker so Claude Code can pick up the run id
  // from stdout without parsing JSON.
  if (result.runId) {
    console.log(`STRAT_RUN_ID=${result.runId}`);
  }

  if (result.status === "error") process.exit(1);
}

main().catch((err) => {
  console.error("[strategy:long-short:morning] unhandled error:", err);
  process.exit(1);
});
