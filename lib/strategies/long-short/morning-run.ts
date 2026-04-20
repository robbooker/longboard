// Long/Short Portfolio — morning routine orchestration.
//
// Phase 1 flow:
//   1. Env preflight (var presence)
//   2. Credential health preflight (parallel pings: Alpaca, Polygon, Exa, Finnhub)
//   3. Idempotency + concurrency check — today's strat_runs must not
//      already have an 'ok' or 'running' row for 'morning'
//   4. Market-open check (skipped in dry mode)
//   5. Insert 'running' sentinel row in strat_runs → runId
//   6. Assemble research bundle
//   7. Call Claude with drill-in tool (up to MAX_DRILL_INS iterations)
//   8. Validate decision JSON
//   9. If enter: size + constraints + order; if skip: straight to finalize
//   10. Finalize: UPDATE the running row to 'ok' | 'error', plus
//       positions + trades rows on enter
//   11. Slack post (tagged [DRY] for dry runs)
//
// Dry mode: skips steps 3, 5, and all Supabase writes. Still posts to
// Slack so the message format can be verified end-to-end.

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
export const MODEL = "claude-sonnet-4-20250514";
const MAX_DRILL_INS = 3;
const POSITIONS_CAP_PHASE1 = 1;

export type MorningRunOpts = { dry?: boolean };

export type MorningRunResult = {
  status: "ok" | "error" | "skipped";
  dry: boolean;
  reason?: string;
  decision?: Decision | null;
  error?: string;
  runId?: string;
  orderId?: string;
};

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
  // A UTC timestamp that is guaranteed to be on-or-before midnight ET
  // today. Using the DST offset (-04:00) here rather than -05:00 yields
  // an earlier-in-UTC cutoff, which is safe — we'd rather include a
  // yesterday-late-night run than miss today's.
  return new Date(`${todayInET()}T00:00:00-04:00`).toISOString();
}

// ── Env preflight ─────────────────────────────────────────────────────

function checkRequiredEnv(): string[] {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "POLYGON_API_KEY",
    "EXA_API_KEY",
    "FINNHUB_API_KEY",
    "ANTHROPIC_API_KEY",
    "SLACK_STRATEGIES_WEBHOOK_URL",
  ];
  return required.filter((k) => !process.env[k]);
}

// ── Idempotency + concurrency ─────────────────────────────────────────

type ExistingRunRow = { id: string; status: string };

/** Returns any 'ok' or 'running' row for today's morning run, or null.
 *  'ok' → already ran successfully; 'running' → another run is in flight;
 *  'error' rows do NOT block — a failed earlier run can be retried. */
async function findTodayNonFailedRun(supabase: SupabaseClient): Promise<ExistingRunRow | null> {
  const { data, error } = await supabase
    .from("strat_runs")
    .select("id, status")
    .eq("strategy_id", STRATEGY_ID)
    .eq("run_type", "morning")
    .in("status", ["ok", "running"])
    .gte("ran_at", startOfTodayUtcFromET())
    .order("ran_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`today_run_lookup_failed: ${error.message}`);
  return (data && data.length > 0) ? (data[0] as ExistingRunRow) : null;
}

async function insertRunningRow(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from("strat_runs")
    .insert({
      strategy_id: STRATEGY_ID,
      run_type: "morning",
      ran_at: new Date().toISOString(),
      inputs: null,
      output: null,
      writeup_md: null,
      status: "running",
      error: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`running_row_insert_failed: ${error?.message ?? "no id"}`);
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

// ── Book-cap check ────────────────────────────────────────────────────

async function currentOpenPositions(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("strat_positions")
    .select("*", { count: "exact", head: true })
    .eq("strategy_id", STRATEGY_ID)
    .is("closed_at", null);
  if (error) throw new Error(`book_count_failed: ${error.message}`);
  return count ?? 0;
}

// ── Claude call (with drill-in tool) ──────────────────────────────────

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
    "Fetch deeper per-ticker research: market data, SEC fundamentals " +
    "(form, going-concern flag, shelf registration, cash + revenue + " +
    "net income), recent news, and sentiment. Use this to dig into a " +
    "specific candidate before making a decision. You may call this " +
    "up to " + MAX_DRILL_INS + " times total across the whole run.",
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

/** Public wrapper for the tool-use-aware Anthropic call loop. The
 *  smoke-test script reuses this with its mocked bundle so the real
 *  Claude integration is what's tested. */
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
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `unknown tool: ${tu.name}`,
          is_error: true,
        });
        continue;
      }
      drillInsUsed++;
      if (drillInsUsed > MAX_DRILL_INS) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `drill-in limit exceeded (max ${MAX_DRILL_INS}); decide now`,
          is_error: true,
        });
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

// ── Constraint enforcement ────────────────────────────────────────────

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

// ── Sizing ────────────────────────────────────────────────────────────

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

// ── Slack formatting ──────────────────────────────────────────────────

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
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
    `→ <https://longboard-ruddy.vercel.app/strategies/long-short|/strategies/long-short>`
  );
}

function slackSkipMessage(opts: { dry: boolean; reason: string }): string {
  const tag = opts.dry ? "[DRY] " : "";
  return (
    `${tag}*Long/Short Portfolio — morning run*\n` +
    `Declined to trade today. ${opts.reason}\n` +
    `→ <https://longboard-ruddy.vercel.app/strategies/long-short|/strategies/long-short>`
  );
}

function slackErrorMessage(opts: { dry: boolean; error: string }): string {
  const tag = opts.dry ? "[DRY] " : "";
  return (
    `${tag}:warning: *Long/Short Portfolio — morning run ERROR*\n` +
    `${opts.error}\n` +
    `→ <https://longboard-ruddy.vercel.app/strategies/long-short|/strategies/long-short>`
  );
}

// ── System + user prompts (exported for smoke test reuse) ─────────────

export async function loadSystemPrompt(): Promise<string> {
  const specPath = path.join(process.cwd(), "docs", "strategies", "long-short.md");
  const spec = await readFile(specPath, "utf8");
  return (
    "You are the Long/Short Portfolio strategist. Your mandate and full " +
    "operating spec is below. Respect every constraint — the server will " +
    "reject any decision that violates them, which wastes a cycle.\n\n" +
    "=== SPEC ===\n" +
    spec +
    "\n=== END SPEC ===\n\n" +
    "Output rule: respond with a single JSON object matching the " +
    "contract. No prose before or after. No markdown fences. Just JSON.\n\n" +
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
    "If decision is 'skip', ticker/side/size_pct/stop_price/catalyst_source/" +
    "expected_horizon_days/holds_through_earnings/holds_through_earnings_reason " +
    "are optional and may be omitted. thesis and writeup_md are still " +
    "required — say why you're passing.\n\n" +
    "You may call the drill_in tool up to " + MAX_DRILL_INS + " times to " +
    "gather deeper context on specific tickers before deciding. After " +
    "drill-ins, produce your final JSON response."
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
    "Based on the above, and optionally after drill-ins on up to " + MAX_DRILL_INS + " tickers, " +
    "produce exactly one trade decision (or zero — 'skip' is valid). Respond with ONLY the JSON object."
  );
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

// ── Finalizers ────────────────────────────────────────────────────────
// Each finalizer posts to Slack and either UPDATEs the existing
// 'running' strat_runs row (live mode, runId present) or skips DB
// writes (dry mode). If an error happens before the 'running' row is
// created, finalizeError falls back to an INSERT so the failure is
// still surfaced on /strategies/long-short.

async function finalizeError(args: {
  dry: boolean;
  runId: string | undefined;
  error: string;
}): Promise<MorningRunResult> {
  const { dry, runId, error } = args;
  console.error(`[morning-run] error: ${error}`);

  try {
    await postStrategiesSlack({ text: slackErrorMessage({ dry, error }) });
  } catch (e) {
    console.error(`[morning-run] slack notify failed: ${e instanceof Error ? e.message : ""}`);
  }

  if (dry) return { status: "error", dry, error, runId };

  try {
    const supabase = adminSupabase();
    if (runId) {
      await updateRun(supabase, runId, { status: "error", error });
    } else {
      const { data, error: insErr } = await supabase
        .from("strat_runs")
        .insert({
          strategy_id: STRATEGY_ID,
          run_type: "morning",
          ran_at: new Date().toISOString(),
          status: "error",
          error,
        })
        .select("id")
        .single();
      if (!insErr && data) {
        return { status: "error", dry, error, runId: (data as { id: string }).id };
      }
    }
  } catch (e) {
    console.error(`[morning-run] persist error failed: ${e instanceof Error ? e.message : ""}`);
  }

  return { status: "error", dry, error, runId };
}

async function finalizeSkip(args: {
  dry: boolean;
  runId: string | undefined;
  decision: Decision;
  bundle: ResearchBundle;
  rawJson: string;
}): Promise<MorningRunResult> {
  const { dry, runId, decision, bundle, rawJson } = args;
  const reason = decision.thesis.slice(0, 180);

  try {
    await postStrategiesSlack({ text: slackSkipMessage({ dry, reason }) });
  } catch (e) {
    console.error(`[morning-run] slack skip failed: ${e instanceof Error ? e.message : ""}`);
  }

  if (dry) return { status: "ok", dry, decision, runId };

  try {
    if (!runId) throw new Error("runId missing at skip finalization");
    const supabase = adminSupabase();
    await updateRun(supabase, runId, {
      inputs: bundle,
      output: { decision: "skip", thesis: decision.thesis, raw: rawJson },
      writeup_md: decision.writeup_md,
      status: "ok",
      error: null,
    });
  } catch (e) {
    console.error(`[morning-run] persist skip failed: ${e instanceof Error ? e.message : ""}`);
  }

  return { status: "ok", dry, decision, runId };
}

async function finalizeEnter(args: {
  dry: boolean;
  runId: string | undefined;
  decision: EnterDecision;
  bundle: ResearchBundle;
  rawJson: string;
  entryPrice: number;
  qty: number;
  accountEquity: number;
  alpaca: { orderId?: string; fillPrice: number | null; status: string; submittedAt: string | null };
}): Promise<MorningRunResult> {
  const { dry, runId, decision, bundle, rawJson, entryPrice, qty, accountEquity, alpaca } = args;

  try {
    await postStrategiesSlack({
      text: slackEnterMessage({ dry, decision, qty, entryPrice, accountEquity }),
    });
  } catch (e) {
    console.error(`[morning-run] slack enter post failed: ${e instanceof Error ? e.message : ""}`);
  }

  if (dry) return { status: "ok", dry, decision, runId };

  try {
    if (!runId) throw new Error("runId missing at enter finalization");
    const supabase = adminSupabase();
    const now = new Date().toISOString();

    await updateRun(supabase, runId, {
      inputs: bundle,
      output: {
        decision: "enter",
        ticker: decision.ticker,
        side: decision.side,
        size_pct: decision.size_pct,
        stop_price: decision.stop_price,
        entry_price: entryPrice,
        qty,
        account_equity_at_sizing: accountEquity,
        alpaca_order_id: alpaca.orderId,
        alpaca_status: alpaca.status,
        raw: rawJson,
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
        opened_at: alpaca.submittedAt ?? now,
        qty,
        entry_price: alpaca.fillPrice ?? entryPrice,
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
      alpaca_order_id: alpaca.orderId ?? null,
      submitted_at: alpaca.submittedAt,
      filled_at: null,
      fill_price: alpaca.fillPrice,
      status: alpaca.status,
    });
    if (tradeErr) throw new Error(`strat_trades: ${tradeErr.message}`);
  } catch (e) {
    const error = `persist_enter_failed: ${e instanceof Error ? e.message : "unknown"} (alpaca_order_id=${alpaca.orderId ?? "n/a"})`;
    console.error(`[morning-run] ${error}`);
    try {
      await postStrategiesSlack({
        text: slackErrorMessage({ dry: false, error: `PARTIAL WRITE: ${error}` }),
      });
    } catch { /* swallow */ }
    // Best-effort: mark the run row as errored so the page reflects it.
    if (runId) {
      try {
        await updateRun(adminSupabase(), runId, { status: "error", error });
      } catch { /* swallow */ }
    }
    return { status: "error", dry, error, runId, orderId: alpaca.orderId };
  }

  return { status: "ok", dry, decision, runId, orderId: alpaca.orderId };
}

// ── Main ──────────────────────────────────────────────────────────────

export async function runLongShortMorning(opts: MorningRunOpts = {}): Promise<MorningRunResult> {
  const dry = opts.dry === true;
  const logPrefix = dry ? "[dry] " : "";
  console.log(`${logPrefix}long-short morning run starting`);

  // 1. Env preflight (no network)
  const missingEnv = checkRequiredEnv();
  if (missingEnv.length > 0) {
    return await finalizeError({
      dry,
      runId: undefined,
      error: `missing env vars: ${missingEnv.join(", ")}`,
    });
  }

  // 2. Credential health preflight — parallel pings.
  let health;
  try {
    health = await credentialHealthCheck(STRATEGY_ID);
    console.log(`${logPrefix}preflight:\n${formatHealthReport(health)}`);
  } catch (e) {
    return await finalizeError({
      dry,
      runId: undefined,
      error: `preflight_crashed: ${e instanceof Error ? e.message : "unknown"}`,
    });
  }
  if (!health.ok) {
    const failed = health.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ");
    return await finalizeError({
      dry,
      runId: undefined,
      error: `preflight_failed: ${failed}`,
    });
  }

  // 3. Idempotency + concurrency + 4. market-open + 5. insert 'running'
  //    row all require Supabase and are skipped in dry mode.
  let runId: string | undefined = undefined;
  if (!dry) {
    const supabase = adminSupabase();

    let existing: ExistingRunRow | null;
    try {
      existing = await findTodayNonFailedRun(supabase);
    } catch (e) {
      return await finalizeError({
        dry,
        runId: undefined,
        error: e instanceof Error ? e.message : "today_run_lookup_failed",
      });
    }
    if (existing) {
      const reason = existing.status === "ok"
        ? "already ran today successfully"
        : "another run in progress (strat_runs status=running)";
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

    try {
      runId = await insertRunningRow(supabase);
      console.log(`${logPrefix}running row inserted: ${runId}`);
    } catch (e) {
      return await finalizeError({
        dry,
        runId: undefined,
        error: e instanceof Error ? e.message : "running_row_insert_failed",
      });
    }
  }

  // 6. Research bundle
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
    return await finalizeError({
      dry,
      runId,
      error: `bundle_failed: ${e instanceof Error ? e.message : "unknown"}`,
    });
  }

  // 7. Claude
  let rawJson: string;
  try {
    const systemPrompt = await loadSystemPrompt();
    const userPrompt = buildUserPrompt(bundle);
    rawJson = await callAnthropic(systemPrompt, userPrompt);
    console.log(`${logPrefix}claude returned ${rawJson.length} chars`);
  } catch (e) {
    return await finalizeError({
      dry,
      runId,
      error: `anthropic_failed: ${e instanceof Error ? e.message : "unknown"}`,
    });
  }

  // 8. Parse + validate
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson.trim());
  } catch {
    return await finalizeError({
      dry,
      runId,
      error: `claude_json_parse_failed: ${rawJson.slice(0, 200)}`,
    });
  }
  const validation = validateDecision(parsed);
  if (!validation.ok) {
    return await finalizeError({
      dry,
      runId,
      error: `decision_invalid: ${validation.errors.join("; ")}`,
    });
  }
  const decision = validation.value;
  console.log(`${logPrefix}decision: ${decision.decision}${decision.decision === "enter" ? ` ${decision.ticker} ${decision.size_pct}%` : ""}`);

  // 9a. Skip branch
  if (decision.decision === "skip") {
    return await finalizeSkip({ dry, runId, decision, bundle, rawJson });
  }

  // 9b. Enter branch
  let entryPrice: number;
  try {
    entryPrice = await fetchLastTradePrice(decision.ticker);
  } catch (e) {
    return await finalizeError({
      dry,
      runId,
      error: `last_price_failed: ${e instanceof Error ? e.message : "unknown"}`,
    });
  }

  let openPositions = 0;
  if (!dry) {
    try {
      openPositions = await currentOpenPositions(adminSupabase());
    } catch (e) {
      return await finalizeError({
        dry,
        runId,
        error: e instanceof Error ? e.message : "book_count_failed",
      });
    }
  }

  const enforce = enforceEnterConstraints(decision, { entryPrice, openPositions });
  if (!enforce.ok) {
    return await finalizeError({
      dry,
      runId,
      error: `constraints_violated: ${enforce.violations.join("; ")}`,
    });
  }

  let accountEquity = 100_000;
  if (!dry) {
    const acct = await fetchStrategyAccount(STRATEGY_ID);
    if (!acct.ok) {
      return await finalizeError({
        dry,
        runId,
        error: `alpaca_account_failed: ${describeAlpacaError(acct)}`,
      });
    }
    accountEquity = acct.value.equity;
  }

  const qty = sizeOrder(accountEquity, decision.size_pct, entryPrice);
  if (qty <= 0) {
    return await finalizeError({
      dry,
      runId,
      error: `qty_zero: equity=${accountEquity}, size_pct=${decision.size_pct}, price=${entryPrice}`,
    });
  }

  let orderId: string | undefined;
  let fillPrice: number | null = null;
  let orderStatus = "dry";
  let submittedAt: string | null = null;
  if (!dry) {
    const order = await submitStrategyMarketOrder(STRATEGY_ID, {
      symbol: decision.ticker,
      qty,
      side: "buy",
      client_order_id: `long-short-morning-${todayInET()}-${randomUUID().slice(0, 8)}`,
    });
    if (!order.ok) {
      return await finalizeError({
        dry,
        runId,
        error: `alpaca_order_failed: ${describeAlpacaError(order)}`,
      });
    }
    orderId = order.value.id;
    fillPrice = order.value.filled_avg_price;
    orderStatus = order.value.status;
    submittedAt = order.value.submitted_at;
  }

  return await finalizeEnter({
    dry,
    runId,
    decision,
    bundle,
    rawJson,
    entryPrice,
    qty,
    accountEquity,
    alpaca: { orderId, fillPrice, status: orderStatus, submittedAt },
  });
}
