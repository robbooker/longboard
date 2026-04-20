// Credential health preflight for the Long/Short Portfolio morning
// routine. Pings each network-dependent service with a cheap trivial
// request and returns a structured report. Fail-fast policy: any
// failure aborts the run before the Anthropic call, surfaces to Slack
// with a specific reason, and writes a strat_runs error row — all
// cheaper than burning a Claude call on a broken pipeline.
//
// Anthropic + Slack are env-var-presence only. Anthropic has no free
// health endpoint; Slack incoming webhooks accept only POSTs (which
// would spam the channel). Alpaca, Polygon, Exa, and Finnhub each get
// a real network ping.

import { fetchStrategyAccount } from "@/lib/strategies/alpaca-strategy";
import { getMarketStatus } from "@/lib/marketCalendar";

export type HealthCheck = {
  name: string;
  ok: boolean;
  detail: string;
  elapsed_ms: number;
};

export type HealthReport = {
  ok: boolean;
  checks: HealthCheck[];
};

const TIMEOUT_MS = 10_000;

async function check(
  name: string,
  fn: () => Promise<string>,
): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, detail, elapsed_ms: Date.now() - started };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown";
    return { name, ok: false, detail, elapsed_ms: Date.now() - started };
  }
}

async function pingAlpaca(strategyId: string): Promise<string> {
  const res = await fetchStrategyAccount(strategyId);
  if (!res.ok) {
    const r = res as { kind?: string; missing?: string[]; status?: number; body?: string; message?: string };
    if (r.kind === "creds_missing") throw new Error(`creds missing: ${(r.missing ?? []).join(", ")}`);
    if (r.kind === "http") throw new Error(`http ${r.status}: ${r.body ?? ""}`);
    throw new Error(r.message ?? "unknown");
  }
  return `equity $${res.value.equity.toLocaleString()}, status ${res.value.status}`;
}

async function pingPolygon(): Promise<string> {
  // getMarketStatus calls /v1/marketstatus/now under the hood. It doesn't
  // throw on Polygon failure — it falls back. Re-issue the fetch directly
  // here so we can verify Polygon is actually reachable.
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY not configured");
  const res = await fetch(
    `https://api.polygon.io/v1/marketstatus/now?apiKey=${key}`,
    { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`http ${res.status}`);
  const data = (await res.json()) as { market?: string };
  void getMarketStatus; // silence unused-import warnings in future refactors
  return `market=${data.market ?? "unknown"}`;
}

async function pingExa(): Promise<string> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY not configured");
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "market", numResults: 1 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const data = (await res.json()) as { results?: unknown[] };
  return `ok (${data.results?.length ?? 0} result)`;
}

async function pingFinnhub(): Promise<string> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not configured");
  // /quote on SPY is ~200 bytes, fast, and always returns live-ish data.
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=SPY&token=${key}`,
    { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`http ${res.status}`);
  const data = (await res.json()) as { c?: number; t?: number };
  if (typeof data.c !== "number") throw new Error("unexpected response shape");
  return `SPY $${data.c.toFixed(2)}`;
}

/** Fires all four pings in parallel. Overall `ok` is true only when
 *  every check passes. Caller aborts the run on ok=false and surfaces
 *  the failing checks in the Slack error message. */
export async function credentialHealthCheck(strategyId: string): Promise<HealthReport> {
  const [alpaca, polygon, exa, finnhub] = await Promise.all([
    check("alpaca", () => pingAlpaca(strategyId)),
    check("polygon", () => pingPolygon()),
    check("exa", () => pingExa()),
    check("finnhub", () => pingFinnhub()),
  ]);
  const checks = [alpaca, polygon, exa, finnhub];
  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

export function formatHealthReport(report: HealthReport): string {
  return report.checks
    .map((c) => `${c.ok ? "✓" : "✗"} ${c.name} (${c.elapsed_ms}ms): ${c.detail}`)
    .join("\n");
}
