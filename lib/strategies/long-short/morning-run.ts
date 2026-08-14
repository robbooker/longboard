// Long/Short Portfolio — morning routine, Design A (Claude-Code-invoker).
//
// Two scripts instead of one. Neither calls the Anthropic SDK on the
// production path. ANTHROPIC_API_KEY is no longer a required env var
// for the cron.
//
//   1. strategy:long-short:morning → stageMorningRun()
//      Runs preflight + credential health + idempotency + market-open.
//      Assembles the research bundle. Inserts a strat_runs row with
//      status='awaiting_decision' and the bundle in inputs. Posts
//      Slack. Exits with the runId printed so the surrounding Claude
//      Code session can feed it to :apply.
//
//   2. strategy:long-short:apply → applyDecision({runId, decision})
//      Claude Code has read the pinned bundle, reasoned about it, and
//      produced a decision JSON matching the contract. This script
//      verifies the run is still awaiting_decision, validates the
//      JSON, enforces server-side constraints, places the Alpaca
//      paper order (on enter), writes positions + trades, flips the
//      run row to 'ok' (or 'error'), posts the final Slack message.
//
// The reference Anthropic SDK integration (callAnthropic +
// loadSystemPrompt + buildUserPrompt + DRILL_IN_TOOL) is still
// exported from this module for the smoke test, which verifies the
// prompt + validator + Slack path against a real Claude call. The
// production cron does not use any of it.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { assembleResearchBundle, type ResearchBundle } from "./research-bundle";
import { fetchResearchBrief } from "@/lib/research-brief";
import {
  validateDecision,
  type Decision,
  type EnterDecision,
} from "./schema";
import { isForbidden } from "@/lib/strategies/forbidden-tickers";
import {
  fetchStrategyAccount,
  submitStrategyMarketOrder,
} from "@/lib/strategies/alpaca-strategy";
import { postStrategiesSlack } from "@/lib/slack";
import { isMarketOpenToday } from "@/lib/marketCalendar";
import { credentialHealthCheck, formatHealthReport } from "./preflight";

const STRATEGY_ID = "long-short";
const MAX_DRILL_INS = 3;
const POSITIONS_CAP_PHASE1 = 1;

/** Kept exported so the reference Anthropic integration below uses a
 *  model string that's easy to audit in one place. The production flow
 *  does not hit this at all; the cron's Claude-Code invoker makes the
 *  decision instead. */
export const MODEL = "claude-sonnet-4-6";

// ── Shared: env, supabase, dates ──────────────────────────────────────

function adminSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase_not_configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function todayInET(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function startOfTodayUtcFromET(): string {
  return new Date(`${todayInET()}T00:00:00-04:00`).toISOString();
}

/** Required env vars for the staging script. ANTHROPIC_API_KEY is
 *  deliberately NOT here — the production path (stage + apply) does
 *  not call the Anthropic API. The smoke test requires it separately
 *  via its own env check. */
function checkRequiredEnvForStage(): string[] {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "POLYGON_API_KEY",
    "EXA_API_KEY",
    "FINNHUB_API_KEY",
    "SLACK_STRATEGIES_WEBHOOK_URL",
  ];
  return required.filter((k) => !process.env[k]);
}

/** Apply only needs to talk to Supabase, Alpaca, Polygon (for last
 *  price), and Slack. No Exa / Finnhub (bundle already pinned). No
 *  Anthropic. */
function checkRequiredEnvForApply(): string[] {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "POLYGON_API_KEY",
    "SLACK_STRATEGIES_WEBHOOK_URL",
  ];
  return required.filter((k) => !process.env[k]);
}

// ── Run row helpers ───────────────────────────────────────────────────

type ExistingRunRow = { id: string; status: string };

/** Returns any row for today that blocks a new staging — status in
 *  ('ok', 'running', 'awaiting_decision'). 'error' rows do NOT block. */
async function findTodayBlockingRun(supabase: SupabaseClient): Promise<ExistingRunRow | null> {
  const { data, error } = await supabase
    .from("strat_runs")
    .select("id, status")
    .eq("strategy_id", STRATEGY_ID)
    .eq("run_type", "morning")
    .in("status", ["ok", "running", "awaiting_decision"])
    .gte("ran_at", startOfTodayUtcFromET())
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`today_run_lookup_failed: ${error.message}`);
  return (data && data.length > 0) ? (data[0] as ExistingRunRow) : null;
}

async function insertAwaitingDecisionRow(
  supabase: SupabaseClient,
  bundle: ResearchBundle,
): Promise<string> {
  const { data, error } = await supabase
    .from("strat_runs")
    .insert({
      strategy_id: STRATEGY_ID,
      run_type: "morning",
      ran_at: new Date().toISOString(),
      inputs: bundle,
      output: null,
      writeup_md: null,
      status: "awaiting_decision",
      error: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`awaiting_decision_insert_failed: ${error?.message ?? "no id"}`);
  return (data as { id: string }).id;
}

async function updateRun(
  supabase: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("strat_runs").update(patch).eq("id", runId);
  if (error) throw new Error(`strat_runs_update_failed: ${error.message}`);
}

async function currentOpenPositions(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("strat_positions")
    .select("*", { count: "exact", head: true })
    .eq("strategy_id", STRATEGY_ID)
    .is("closed_at", null);
  if (error) throw new Error(`book_count_failed: ${error.message}`);
  return count ?? 0;
}

// ── Constraint + sizing helpers ───────────────────────────────────────

type EnforceResult = { ok: true } | { ok: false; violations: string[] };

function enforceEnterConstraints(
  decision: EnterDecision,
  ctx: { entryPrice: number; openPositions: number },
): EnforceResult {
  const violations: string[] = [];
  if (isForbidden(decision.ticker)) {
    violations.push(`forbidden_ticker: ${decision.ticker} is on the leveraged/inverse ETF list`);
  }
  if (decision.side !== "long") {
    violations.push(`side_must_be_long: got '${decision.side}' (shorts arrive in Phase 2)`);
  }
  if (decision.size_pct < 3 || decision.size_pct > 7) {
    violations.push(`size_out_of_range: ${decision.size_pct}% not in [3, 7]`);
  }
  if (!Number.isFinite(decision.stop_price) || decision.stop_price <= 0) {
    violations.push(`stop_invalid: ${decision.stop_price}`);
  }
  if (decision.stop_price >= ctx.entryPrice) {
    violations.push(
      `stop_not_below_entry: stop ${decision.stop_price} must be below entry ${ctx.entryPrice} for a long`,
    );
  }
  if (ctx.openPositions + 1 > POSITIONS_CAP_PHASE1) {
    violations.push(
      `book_cap_exceeded: ${ctx.openPositions} open + 1 new > ${POSITIONS_CAP_PHASE1} (Phase 1 cap)`,
    );
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

function sizeOrder(equity: number, sizePct: number, price: number): number {
  const allocation = (equity * sizePct) / 100;
  return Math.max(0, Math.floor(allocation / price));
}

async function fetchLastTradePrice(ticker: string): Promise<number> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY not configured");
  const res = await fetch(
    `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${key}`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`polygon snapshot ${res.status}`);
  const data = (await res.json()) as {
    ticker?: {
      lastTrade?: { p?: number };
      day?: { c?: number };
      prevDay?: { c?: number };
      min?: { c?: number };
    };
  };
  const t = data.ticker;
  const price = t?.lastTrade?.p ?? t?.min?.c ?? t?.day?.c ?? t?.prevDay?.c ?? 0;
  if (!price) throw new Error(`no_price_for_${ticker}`);
  return price;
}

function describeAlpacaError(res: { ok: false } & Record<string, unknown>): string {
  const r = res as {
    kind?: "creds_missing" | "http" | "unknown";
    missing?: string[];
    status?: number;
    body?: string;
    message?: string;
  };
  if (r.kind === "creds_missing") return `creds missing: ${(r.missing ?? []).join(", ")}`;
  if (r.kind === "http") return `http ${r.status}: ${r.body ?? ""}`;
  return r.message ?? "unknown alpaca error";
}

// ── Slack formatters ──────────────────────────────────────────────────

/** Canonical production domain for links in Slack messages. Reads
 *  from the same env var (NEXT_PUBLIC_SITE_URL) that app/layout.tsx,
 *  app/login/forgot/page.tsx, and app/api/admin/invites/route.ts use;
 *  falls through to the prod domain so OpenClaw doesn't strictly
 *  need the env var set. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://longboardai.com";

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function slackStageMessage(opts: { dry: boolean; runId: string | null; bundle: ResearchBundle }): string {
  const tag = opts.dry ? "[DRY] " : "";
  const runRef = opts.runId ? `run ${opts.runId.slice(0, 8)}` : "no run id (dry)";
  return (
    `${tag}*Long/Short Portfolio — morning bundle pinned*\n` +
    `${opts.bundle.top_news.length} news · ` +
    `${opts.bundle.earnings_today.length} earnings · ` +
    `${opts.bundle.pre_market_movers.length} movers · ${runRef}\n` +
    `Awaiting decision from Claude Code.\n` +
    `→ <${SITE_URL}/strategies/long-short|/strategies/long-short>`
  );
}

function slackEnterMessage(opts: {
  dry: boolean;
  decision: EnterDecision;
  qty: number;
  entryPrice: number;
  accountEquity: number;
}): string {
  const { dry, decision, qty, entryPrice } = opts;
  const tag = dry ? "[DRY] " : "";
  const firstSentence = decision.thesis.split(/[.!?]\s/)[0].trim();
  return (
    `${tag}*Long/Short Portfolio — morning run*\n` +
    `Bought ${decision.ticker} · ${qty} shares @ ${fmtUSD(entryPrice)} · ` +
    `stop ${fmtUSD(decision.stop_price)} · size ${decision.size_pct}%\n` +
    `Thesis: ${firstSentence}${firstSentence.endsWith(".") ? "" : "."}\n` +
    `→ <${SITE_URL}/strategies/long-short|/strategies/long-short>`
  );
}

function slackSkipMessage(opts: { dry: boolean; reason: string }): string {
  const tag = opts.dry ? "[DRY] " : "";
  return (
    `${tag}*Long/Short Portfolio — morning run*\n` +
    `Declined to trade today. ${opts.reason}\n` +
    `→ <${SITE_URL}/strategies/long-short|/strategies/long-short>`
  );
}

function slackErrorMessage(opts: { dry: boolean; error: string }): string {
  const tag = opts.dry ? "[DRY] " : "";
  return (
    `${tag}:warning: *Long/Short Portfolio — morning run ERROR*\n` +
    `${opts.error}\n` +
    `→ <${SITE_URL}/strategies/long-short|/strategies/long-short>`
  );
}

async function postSlackBestEffort(text: string): Promise<void> {
  try {
    await postStrategiesSlack({ text });
  } catch (e) {
    console.error(`[long-short] slack post failed (swallowed): ${e instanceof Error ? e.message : "unknown"}`);
  }
}

// ── Reference Anthropic integration (smoke test + future) ─────────────
// NOT on the production cron path. The production stage + apply scripts
// do not import callAnthropic. Kept here so the smoke test has a
// realistic end-to-end Claude-API sanity check, and so the prompt
// contract stays in one file.

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  >;
};

export const DRILL_IN_TOOL = {
  name: "drill_in",
  description:
    "Fetch deeper per-ticker research: market data, SEC fundamentals, " +
    "recent news, and sentiment. Use this to dig into a specific " +
    "candidate before making a decision. Up to " + MAX_DRILL_INS + " calls per run.",
  input_schema: {
    type: "object" as const,
    properties: {
      ticker: { type: "string", description: "US stock ticker symbol, uppercase" },
    },
    required: ["ticker"],
  },
};

async function runDrillIn(ticker: string): Promise<string> {
  const brief = await fetchResearchBrief(ticker);
  return JSON.stringify(brief);
}

export async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  tools: Array<typeof DRILL_IN_TOOL> = [DRILL_IN_TOOL],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const messages: AnthropicMessage[] = [{ role: "user", content: userPrompt }];
  let drillInsUsed = 0;

  for (let iter = 0; iter < 1 + MAX_DRILL_INS + 1; iter++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`anthropic ${res.status}: ${text.slice(0, 400)}`);
    }
    const data = (await res.json()) as {
      stop_reason: string;
      content: AnthropicContentBlock[];
    };

    messages.push({ role: "assistant", content: data.content });

    if (data.stop_reason !== "tool_use") {
      const textBlock = data.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("anthropic: no text content in final response");
      }
      return textBlock.text;
    }

    const toolUses = data.content.filter(
      (b): b is Extract<AnthropicContentBlock, { type: "tool_use" }> => b.type === "tool_use",
    );
    if (toolUses.length === 0) {
      throw new Error("anthropic: stop_reason=tool_use but no tool_use blocks");
    }

    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];

    for (const tu of toolUses) {
      if (tu.name !== DRILL_IN_TOOL.name) {
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `unknown tool: ${tu.name}`, is_error: true });
        continue;
      }
      drillInsUsed++;
      if (drillInsUsed > MAX_DRILL_INS) {
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `drill-in limit exceeded (max ${MAX_DRILL_INS}); decide now`, is_error: true });
        continue;
      }
      const ticker = (tu.input.ticker as string | undefined) ?? "";
      try {
        const brief = await runDrillIn(ticker);
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: brief });
      } catch (e) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `drill-in failed: ${e instanceof Error ? e.message : "unknown"}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("anthropic: exhausted iterations without final text");
}

export async function loadSystemPrompt(): Promise<string> {
  const specPath = path.join(process.cwd(), "docs", "strategies", "long-short.md");
  const spec = await readFile(specPath, "utf8");
  return (
    "You are the Long/Short Portfolio strategist. Your mandate and full " +
    "operating spec is below. Respect every constraint — the server will " +
    "reject any decision that violates them.\n\n" +
    "=== SPEC ===\n" +
    spec +
    "\n=== END SPEC ===\n\n" +
    "Output rule: respond with a single JSON object matching the contract. " +
    "No prose before or after. No markdown fences.\n\n" +
    "The JSON shape is:\n" +
    "{\n" +
    '  "decision": "enter" | "skip",\n' +
    '  "ticker": "TICKER" | null,\n' +
    '  "side": "long",\n' +
    '  "size_pct": 3.0 to 7.0,\n' +
    '  "stop_price": number,\n' +
    '  "thesis": "prose",\n' +
    '  "catalyst_source": "url or description",\n' +
    '  "expected_horizon_days": number,\n' +
    '  "holds_through_earnings": true|false,\n' +
    '  "holds_through_earnings_reason": "string or null",\n' +
    '  "writeup_md": "full markdown writeup for archive + UI"\n' +
    "}\n\n" +
    "Skip is valid — thesis and writeup_md required even then. You may " +
    "call the drill_in tool up to " + MAX_DRILL_INS + " times."
  );
}

export function buildUserPrompt(bundle: ResearchBundle): string {
  return (
    "Morning research bundle for " + bundle.as_of_date_et + " (ET).\n\n" +
    (bundle.errors.length > 0
      ? "NOTE: some data layers failed — " + bundle.errors.join("; ") + "\n\n"
      : "") +
    "=== TOP NEWS (Exa, last ~12h) ===\n" +
    (bundle.top_news.length === 0
      ? "(none)\n"
      : bundle.top_news.map((n, i) =>
          `${i + 1}. ${n.title}\n   ${n.url}\n   ` +
          (n.highlights.length > 0 ? n.highlights.join(" | ") : "(no highlights)")
        ).join("\n\n")
    ) +
    "\n\n=== EARNINGS TODAY (Finnhub) ===\n" +
    (bundle.earnings_today.length === 0
      ? "(none or not available)\n"
      : bundle.earnings_today.map((e) =>
          `${e.ticker} · ${e.when} · EPS est ${e.eps_estimate ?? "—"} · Rev est ${e.revenue_estimate ?? "—"}`
        ).join("\n")
    ) +
    "\n\n=== PRE-MARKET MOVERS (Polygon snapshot) ===\n" +
    (bundle.pre_market_movers.length === 0
      ? "(none)\n"
      : bundle.pre_market_movers.map((m) =>
          `${m.ticker} · ${m.change_pct >= 0 ? "+" : ""}${m.change_pct.toFixed(2)}% · $${m.price.toFixed(2)} · vol ${m.volume.toLocaleString()}`
        ).join("\n")
    ) +
    "\n\n=== INSTRUCTION ===\n" +
    "Produce exactly one trade decision (or zero — 'skip' is valid). Respond with ONLY the JSON object."
  );
}

// ── Staging: strategy:long-short:morning ──────────────────────────────

export type StageOpts = { dry?: boolean };

export type StageResult = {
  status: "awaiting_decision" | "skipped" | "error" | "dry_ok";
  dry: boolean;
  runId?: string;
  reason?: string;
  error?: string;
  bundle?: ResearchBundle;
};

/** Runs preflight, assembles the research bundle, and pins it in a
 *  strat_runs row with status='awaiting_decision'. Does not call
 *  Anthropic. Production cron runs this, then hands the runId to the
 *  surrounding Claude Code session, which reasons and calls
 *  :apply. */
export async function stageMorningRun(opts: StageOpts = {}): Promise<StageResult> {
  const dry = opts.dry === true;
  const logPrefix = dry ? "[dry] " : "";
  console.log(`${logPrefix}long-short morning: staging`);

  // 1. Env preflight (no network). ANTHROPIC_API_KEY not needed.
  const missing = checkRequiredEnvForStage();
  if (missing.length > 0) {
    const error = `missing env vars: ${missing.join(", ")}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    return { status: "error", dry, error };
  }

  // 2. Credential health preflight.
  try {
    const health = await credentialHealthCheck(STRATEGY_ID);
    console.log(`${logPrefix}preflight:\n${formatHealthReport(health)}`);
    if (!health.ok) {
      const failed = health.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ");
      const error = `preflight_failed: ${failed}`;
      await postSlackBestEffort(slackErrorMessage({ dry, error }));
      return { status: "error", dry, error };
    }
  } catch (e) {
    const error = `preflight_crashed: ${e instanceof Error ? e.message : "unknown"}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    return { status: "error", dry, error };
  }

  // 3. Idempotency + concurrency + 4. market-open (skipped in dry).
  if (!dry) {
    const supabase = adminSupabase();

    let existing: ExistingRunRow | null;
    try {
      existing = await findTodayBlockingRun(supabase);
    } catch (e) {
      const error = e instanceof Error ? e.message : "today_run_lookup_failed";
      await postSlackBestEffort(slackErrorMessage({ dry, error }));
      return { status: "error", dry, error };
    }
    if (existing) {
      const reason =
        existing.status === "ok" ? "already ran today successfully" :
        existing.status === "awaiting_decision" ? "another run is already awaiting a decision" :
        "another run in progress";
      console.log(`${logPrefix}skipping: ${reason}`);
      return { status: "skipped", dry, reason };
    }

    try {
      if (!(await isMarketOpenToday())) {
        const reason = "market closed (weekend or holiday)";
        console.log(`${logPrefix}skipping: ${reason}`);
        return { status: "skipped", dry, reason };
      }
    } catch (e) {
      console.warn(`${logPrefix}market-open check failed; continuing: ${e instanceof Error ? e.message : ""}`);
    }
  }

  // 5. Research bundle.
  let bundle: ResearchBundle;
  try {
    bundle = await assembleResearchBundle();
    console.log(
      `${logPrefix}bundle: ${bundle.top_news.length} news, ` +
      `${bundle.earnings_today.length} earnings, ` +
      `${bundle.pre_market_movers.length} movers, ` +
      `${bundle.errors.length} layer errors`,
    );
  } catch (e) {
    const error = `bundle_failed: ${e instanceof Error ? e.message : "unknown"}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    return { status: "error", dry, error };
  }

  // 6. Pin the bundle in a strat_runs row (live only).
  let runId: string | undefined;
  if (!dry) {
    try {
      runId = await insertAwaitingDecisionRow(adminSupabase(), bundle);
      console.log(`${logPrefix}awaiting_decision row inserted: ${runId}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : "awaiting_decision_insert_failed";
      await postSlackBestEffort(slackErrorMessage({ dry, error }));
      return { status: "error", dry, error };
    }
  }

  // 7. Slack the stage message.
  await postSlackBestEffort(slackStageMessage({ dry, runId: runId ?? null, bundle }));

  return dry
    ? { status: "dry_ok", dry, bundle }
    : { status: "awaiting_decision", dry, runId, bundle };
}

// ── Apply: strategy:long-short:apply ──────────────────────────────────

export type ApplyOpts = {
  runId: string;
  decision: unknown;
  dry?: boolean;
};

export type ApplyResult = {
  status: "ok" | "error";
  dry: boolean;
  runId: string;
  decision?: Decision;
  error?: string;
  orderId?: string;
};

/** Validates a decision JSON against the contract, enforces
 *  server-side constraints, places the Alpaca paper order (on enter),
 *  writes strat_positions + strat_trades, and flips the run row from
 *  'awaiting_decision' to 'ok' (or 'error'). */
export async function applyDecision(opts: ApplyOpts): Promise<ApplyResult> {
  const dry = opts.dry === true;
  const logPrefix = dry ? "[dry] " : "";
  const { runId } = opts;
  console.log(`${logPrefix}long-short apply: runId=${runId}`);

  // Env preflight (minus Anthropic + Exa + Finnhub — all irrelevant here).
  const missing = checkRequiredEnvForApply();
  if (missing.length > 0) {
    const error = `missing env vars: ${missing.join(", ")}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    return { status: "error", dry, runId, error };
  }

  const supabase = adminSupabase();

  // Verify run row exists and is still awaiting_decision.
  const { data: rows, error: lookupErr } = await supabase
    .from("strat_runs")
    .select("id, status")
    .eq("id", runId)
    .limit(1);
  if (lookupErr) {
    const error = `run_lookup_failed: ${lookupErr.message}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    return { status: "error", dry, runId, error };
  }
  if (!rows || rows.length === 0) {
    const error = `run_not_found: ${runId}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    return { status: "error", dry, runId, error };
  }
  const existing = rows[0] as { id: string; status: string };
  if (existing.status !== "awaiting_decision") {
    const error = `run_not_applicable: status='${existing.status}' (must be 'awaiting_decision')`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    return { status: "error", dry, runId, error };
  }

  // Validate the decision JSON.
  const validation = validateDecision(opts.decision);
  if (!validation.ok) {
    const error = `decision_invalid: ${validation.errors.join("; ")}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    if (!dry) {
      try {
        await updateRun(supabase, runId, { status: "error", error });
      } catch { /* swallow */ }
    }
    return { status: "error", dry, runId, error };
  }
  const decision = validation.value;
  console.log(`${logPrefix}decision: ${decision.decision}${decision.decision === "enter" ? ` ${decision.ticker} ${decision.size_pct}%` : ""}`);

  // Skip path — record + slack + done.
  if (decision.decision === "skip") {
    await postSlackBestEffort(slackSkipMessage({ dry, reason: decision.thesis.slice(0, 180) }));
    if (dry) return { status: "ok", dry, runId, decision };
    try {
      await updateRun(supabase, runId, {
        output: { decision: "skip", thesis: decision.thesis, writeup_md: decision.writeup_md },
        writeup_md: decision.writeup_md,
        status: "ok",
        error: null,
      });
    } catch (e) {
      const error = `persist_skip_failed: ${e instanceof Error ? e.message : "unknown"}`;
      console.error(`[long-short] ${error}`);
      return { status: "error", dry, runId, error };
    }
    return { status: "ok", dry, runId, decision };
  }

  // Enter path — price + constraints + account + order + writes + slack.
  let entryPrice: number;
  try {
    entryPrice = await fetchLastTradePrice(decision.ticker);
  } catch (e) {
    const error = `last_price_failed: ${e instanceof Error ? e.message : "unknown"}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    if (!dry) {
      try { await updateRun(supabase, runId, { status: "error", error }); } catch { /* swallow */ }
    }
    return { status: "error", dry, runId, error };
  }

  let openPositions = 0;
  if (!dry) {
    try {
      openPositions = await currentOpenPositions(supabase);
    } catch (e) {
      const error = e instanceof Error ? e.message : "book_count_failed";
      await postSlackBestEffort(slackErrorMessage({ dry, error }));
      try { await updateRun(supabase, runId, { status: "error", error }); } catch { /* swallow */ }
      return { status: "error", dry, runId, error };
    }
  }

  const enforce = enforceEnterConstraints(decision, { entryPrice, openPositions });
  if (!enforce.ok) {
    const error = `constraints_violated: ${enforce.violations.join("; ")}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    if (!dry) {
      try { await updateRun(supabase, runId, { status: "error", error }); } catch { /* swallow */ }
    }
    return { status: "error", dry, runId, error };
  }

  // Equity + qty.
  let accountEquity = 100_000;
  if (!dry) {
    const acct = await fetchStrategyAccount(STRATEGY_ID);
    if (!acct.ok) {
      const error = `alpaca_account_failed: ${describeAlpacaError(acct)}`;
      await postSlackBestEffort(slackErrorMessage({ dry, error }));
      try { await updateRun(supabase, runId, { status: "error", error }); } catch { /* swallow */ }
      return { status: "error", dry, runId, error };
    }
    accountEquity = acct.value.equity;
  }
  const qty = sizeOrder(accountEquity, decision.size_pct, entryPrice);
  if (qty <= 0) {
    const error = `qty_zero: equity=${accountEquity}, size_pct=${decision.size_pct}, price=${entryPrice}`;
    await postSlackBestEffort(slackErrorMessage({ dry, error }));
    if (!dry) {
      try { await updateRun(supabase, runId, { status: "error", error }); } catch { /* swallow */ }
    }
    return { status: "error", dry, runId, error };
  }

  // Place the order (live only).
  let orderId: string | undefined;
  let fillPrice: number | null = null;
  let orderStatus = "dry";
  let submittedAt: string | null = null;
  if (!dry) {
    const order = await submitStrategyMarketOrder(STRATEGY_ID, {
      symbol: decision.ticker,
      qty,
      side: "buy",
      client_order_id: `long-short-${todayInET()}-${randomUUID().slice(0, 8)}`,
    });
    if (!order.ok) {
      const error = `alpaca_order_failed: ${describeAlpacaError(order)}`;
      await postSlackBestEffort(slackErrorMessage({ dry, error }));
      try { await updateRun(supabase, runId, { status: "error", error }); } catch { /* swallow */ }
      return { status: "error", dry, runId, error };
    }
    orderId = order.value.id;
    fillPrice = order.value.filled_avg_price;
    orderStatus = order.value.status;
    submittedAt = order.value.submitted_at;
  }

  // Slack the enter message first so Rob sees it even if the DB writes choke.
  await postSlackBestEffort(slackEnterMessage({ dry, decision, qty, entryPrice, accountEquity }));

  if (dry) return { status: "ok", dry, runId, decision };

  // DB writes — UPDATE the run row, INSERT positions, INSERT trades.
  try {
    const now = new Date().toISOString();
    await updateRun(supabase, runId, {
      output: {
        decision: "enter",
        ticker: decision.ticker,
        side: decision.side,
        size_pct: decision.size_pct,
        stop_price: decision.stop_price,
        entry_price: entryPrice,
        qty,
        account_equity_at_sizing: accountEquity,
        alpaca_order_id: orderId,
        alpaca_status: orderStatus,
      },
      writeup_md: decision.writeup_md,
      status: "ok",
      error: null,
    });

    const { data: posData, error: posErr } = await supabase
      .from("strat_positions")
      .insert({
        strategy_id: STRATEGY_ID,
        ticker: decision.ticker,
        side: decision.side,
        opened_at: submittedAt ?? now,
        qty,
        entry_price: fillPrice ?? entryPrice,
        stop_price: decision.stop_price,
        thesis: decision.thesis,
        opened_by_run_id: runId,
      })
      .select("id")
      .single();
    if (posErr || !posData) throw new Error(`strat_positions: ${posErr?.message ?? "no id returned"}`);
    const positionId = (posData as { id: string }).id;

    const { error: tradeErr } = await supabase.from("strat_trades").insert({
      strategy_id: STRATEGY_ID,
      position_id: positionId,
      run_id: runId,
      ticker: decision.ticker,
      side: "buy",
      qty,
      order_type: "market",
      alpaca_order_id: orderId ?? null,
      submitted_at: submittedAt,
      filled_at: null,
      fill_price: fillPrice,
      status: orderStatus,
    });
    if (tradeErr) throw new Error(`strat_trades: ${tradeErr.message}`);
  } catch (e) {
    const error = `persist_enter_failed: ${e instanceof Error ? e.message : "unknown"} (alpaca_order_id=${orderId ?? "n/a"})`;
    console.error(`[long-short] ${error}`);
    await postSlackBestEffort(slackErrorMessage({ dry: false, error: `PARTIAL WRITE: ${error}` }));
    try { await updateRun(supabase, runId, { status: "error", error }); } catch { /* swallow */ }
    return { status: "error", dry: false, runId, error, orderId };
  }

  return { status: "ok", dry, runId, decision, orderId };
}
