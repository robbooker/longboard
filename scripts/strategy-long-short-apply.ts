// CLI entry point — apply half of the Long/Short Portfolio morning
// routine (Design A, Claude-Code-invoker). Takes a decision JSON
// produced by Claude Code, validates it against the contract,
// enforces server-side constraints, places the Alpaca paper order
// (on enter), writes positions + trades, and flips the run row from
// 'awaiting_decision' to 'ok'.
//
// Usage:
//   # decision in a file
//   npm run strategy:long-short:apply -- \
//     --run-id=<uuid> --decision-file=/tmp/long-short-decision.json
//
//   # decision on stdin
//   cat /tmp/decision.json | npm run strategy:long-short:apply -- --run-id=<uuid>
//
//   # dry mode — no Alpaca order, no DB writes, Slack tagged [DRY]
//   npm run strategy:long-short:apply -- --run-id=<uuid> --decision-file=... --dry
//
// The decision JSON must match the contract in
// lib/strategies/long-short/schema.ts — the apply script validates
// before doing anything.

import { readFile } from "node:fs/promises";
import { applyDecision } from "@/lib/strategies/long-short/morning-run";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const runId = arg("run-id");
  if (!runId) {
    console.error("[strategy:long-short:apply] --run-id=<uuid> is required");
    process.exit(1);
  }

  const dry = process.argv.includes("--dry");
  const decisionFile = arg("decision-file");

  let decisionRaw: string;
  if (decisionFile) {
    decisionRaw = await readFile(decisionFile, "utf8");
  } else {
    decisionRaw = await readStdin();
    if (!decisionRaw.trim()) {
      console.error("[strategy:long-short:apply] no decision provided — pass --decision-file=<path> or pipe JSON via stdin");
      process.exit(1);
    }
  }

  let decision: unknown;
  try {
    decision = JSON.parse(decisionRaw);
  } catch (e) {
    console.error(`[strategy:long-short:apply] decision JSON parse failed: ${e instanceof Error ? e.message : "unknown"}`);
    console.error(`[strategy:long-short:apply] first 200 chars: ${decisionRaw.slice(0, 200)}`);
    process.exit(1);
  }

  console.log(`[strategy:long-short:apply] run_id=${runId}${dry ? " (dry)" : ""}`);
  const result = await applyDecision({ runId, decision, dry });
  console.log(`[strategy:long-short:apply] done:`, {
    status: result.status,
    decision: result.decision?.decision ?? null,
    error: result.error ?? null,
    orderId: result.orderId ?? null,
    dry: result.dry,
  });

  if (result.status === "error") process.exit(1);
}

main().catch((err) => {
  console.error("[strategy:long-short:apply] unhandled error:", err);
  process.exit(1);
});
