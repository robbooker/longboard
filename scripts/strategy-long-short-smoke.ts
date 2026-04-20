// Smoke test for the Long/Short Portfolio pipeline.
//
// Drives the same Claude + validator + Slack-post flow that
// runLongShortMorning uses, but with a mocked research bundle — no
// Exa / Polygon / Finnhub calls, no Supabase writes, no Alpaca order.
// Slack message is tagged [SMOKE].
//
// Use this before shipping any morning-run change. It exercises the
// contract (prompt → Claude → valid JSON → Slack) without the cost
// and flakiness of the live research pipeline.
//
// Run: npm run strategy:long-short:smoke

import { callAnthropic, loadSystemPrompt, buildUserPrompt } from "@/lib/strategies/long-short/morning-run";
import { validateDecision } from "@/lib/strategies/long-short/schema";
import { MOCK_BUNDLE } from "@/lib/strategies/long-short/mock-bundle";
import { postStrategiesSlack } from "@/lib/slack";

async function main() {
  console.log("[smoke] starting");

  // 1. Prompts built from mock bundle.
  let systemPrompt: string;
  let userPrompt: string;
  try {
    systemPrompt = await loadSystemPrompt();
    userPrompt = buildUserPrompt(MOCK_BUNDLE);
    console.log(`[smoke] system prompt: ${systemPrompt.length} chars`);
    console.log(`[smoke] user prompt:   ${userPrompt.length} chars`);
  } catch (e) {
    fail(`prompt_build_failed: ${msg(e)}`);
    return;
  }

  // 2. Real Claude call (this is the point of the smoke test — catch
  //    model/API regressions before they fire on a real morning run).
  let rawJson: string;
  try {
    rawJson = await callAnthropic(systemPrompt, userPrompt);
    console.log(`[smoke] claude returned ${rawJson.length} chars`);
  } catch (e) {
    fail(`anthropic_failed: ${msg(e)}`);
    return;
  }

  // 3. Validator contract.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson.trim());
  } catch {
    fail(`json_parse_failed: ${rawJson.slice(0, 200)}`);
    return;
  }
  const validation = validateDecision(parsed);
  if (!validation.ok) {
    fail(`decision_invalid: ${validation.errors.join("; ")}`);
    return;
  }
  console.log(`[smoke] decision: ${validation.value.decision}`);

  // 4. Slack post with [SMOKE] tag.
  const decision = validation.value;
  const summary = decision.decision === "enter"
    ? `enter ${decision.ticker} · ${decision.size_pct}% · stop $${decision.stop_price.toFixed(2)}`
    : `skip — ${decision.thesis.slice(0, 120)}`;
  try {
    await postStrategiesSlack({
      text: `[SMOKE] Long/Short Portfolio pipeline check — ${summary}`,
    });
    console.log("[smoke] slack post ok");
  } catch (e) {
    fail(`slack_failed: ${msg(e)}`);
    return;
  }

  console.log("[smoke] PASS");
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "unknown";
}

async function fail(reason: string) {
  console.error(`[smoke] FAIL: ${reason}`);
  // Best-effort: post a failure alert to Slack so Rob sees it even if
  // he wasn't watching the terminal.
  try {
    await postStrategiesSlack({
      text: `:warning: [SMOKE] Long/Short pipeline check FAILED: ${reason}`,
    });
  } catch { /* swallow */ }
  process.exit(1);
}

main().catch((err) => {
  console.error("[smoke] unhandled error:", err);
  process.exit(1);
});
