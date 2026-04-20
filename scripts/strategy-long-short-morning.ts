// CLI entry point for the Long/Short Portfolio morning run.
//
// Local:    npm run strategy:long-short:morning [-- --dry]
// OpenClaw: cron runs `npm run strategy:long-short:morning` via a
//           `su - openclaw -s /bin/bash -c '...'` shell; env vars are
//           injected directly (no --env-file needed).
//
// The package.json script uses --env-file-if-exists=.env.local so the
// same invocation works in both contexts: local dev picks up .env.local,
// the cron path finds no such file and falls through to the injected
// env.

import { runLongShortMorning } from "@/lib/strategies/long-short/morning-run";

const args = new Set(process.argv.slice(2));
const dry = args.has("--dry");

async function main() {
  console.log(`[strategy:long-short:morning] starting${dry ? " (dry)" : ""}`);
  const result = await runLongShortMorning({ dry });
  console.log(`[strategy:long-short:morning] done:`, {
    status: result.status,
    reason: result.reason ?? null,
    error: result.error ?? null,
    decision: result.decision?.decision ?? null,
    runId: result.runId ?? null,
    orderId: result.orderId ?? null,
    dry: result.dry,
  });
  if (result.status === "error") process.exit(1);
}

main().catch((err) => {
  console.error("[strategy:long-short:morning] unhandled error:", err);
  process.exit(1);
});
