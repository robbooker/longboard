// CLI entry point — staging half of the Long/Short Portfolio morning
// routine (Design A, Claude-Code-invoker). Pins the research bundle
// in a strat_runs row with status='awaiting_decision', writes the
// bundle to a /tmp file keyed on the run id, and exits.
//
// After this exits cleanly, the shell wrapper at
// scripts/run-long-short-morning.sh reads both the run id and the
// bundle file off stdout + disk, feeds the bundle to the `claude`
// CLI as a user prompt with the spec as system prompt, writes the
// returned decision JSON to a second /tmp file, and calls:
//   npm run strategy:long-short:apply -- --run-id=<id> --decision-file=<path>
//
// Local:    npm run strategy:long-short:morning [-- --dry]
// OpenClaw: env vars sourced from .secrets by the shell wrapper.
//
// On success the script prints both a `STRAT_RUN_ID=<uuid>` line
// AND a `STRAT_BUNDLE_FILE=<path>` line. The shell wrapper greps
// for both.

import { writeFile } from "node:fs/promises";
import { stageMorningRun } from "@/lib/strategies/long-short/morning-run";

const args = new Set(process.argv.slice(2));
const dry = args.has("--dry");

// --invoker=<x> is accepted for compatibility with the cron system-event
// wording, but stage doesn't branch on it — neither mode calls the
// Anthropic API on this path. Kept as a tag only.
const invoker = process.argv.slice(2).find((a) => a.startsWith("--invoker="))?.slice(10) ?? "claude-code";

function bundlePathFor(runId: string): string {
  return `/tmp/long-short-bundle-${runId}.json`;
}

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

  // Emit the bundle to a known /tmp path so the shell wrapper can
  // pipe it to `claude` without a second Supabase query. Keyed on
  // the run id to avoid collisions across same-day retries.
  if (result.runId && result.bundle) {
    const bundlePath = bundlePathFor(result.runId);
    try {
      await writeFile(bundlePath, JSON.stringify(result.bundle, null, 2));
      console.log(`STRAT_BUNDLE_FILE=${bundlePath}`);
    } catch (e) {
      console.error(`[strategy:long-short:morning] bundle write failed: ${e instanceof Error ? e.message : "unknown"}`);
      // Non-fatal: the run row still has `inputs`; shell wrapper
      // falls back to a Supabase query if the file is missing.
    }
  }

  // Prominent, greppable marker so the shell wrapper can pick up the
  // run id from stdout without parsing JSON.
  if (result.runId) {
    console.log(`STRAT_RUN_ID=${result.runId}`);
  }

  if (result.status === "error") process.exit(1);
}

main().catch((err) => {
  console.error("[strategy:long-short:morning] unhandled error:", err);
  process.exit(1);
});
