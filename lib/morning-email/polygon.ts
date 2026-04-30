import type { MorningEmailStock, QaMessage } from "./types";

const POLYGON_BASE = "https://api.polygon.io";

type SnapshotTicker = {
  ticker?: string;
  todaysChangePerc?: number;
  day?: { c?: number; v?: number };
  lastTrade?: { p?: number };
  min?: { v?: number };
};

type ReferenceData = {
  ticker: string;
  type: string | null;
  name: string | null;
  marketCap: number | null;
  shareClassShares: number | null;
  weightedSharesOutstanding: number | null;
};

type RawSnapshot = {
  ticker: string;
  changePct: number;
  lastPrice: number;
  volume: number;
};

export type ScanResult = {
  stocks: MorningEmailStock[];
  qa: QaMessage[];
  live: boolean;
};

const TARGET_STOCKS = 5;

const WARRANT_SUFFIX = /(?:WS|WT|W)$/;

async function polygonGet<T>(path: string): Promise<T> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) throw new Error("POLYGON_API_KEY not configured");
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${POLYGON_BASE}${path}${sep}apiKey=${key}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Polygon ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function toRaw(t: SnapshotTicker): RawSnapshot | null {
  if (!t.ticker) return null;
  const lastPrice = t.lastTrade?.p ?? t.day?.c ?? 0;
  const volume = t.day?.v ?? t.min?.v ?? 0;
  return {
    ticker: t.ticker,
    changePct: t.todaysChangePerc ?? 0,
    lastPrice,
    volume,
  };
}

export async function fetchPolygonGainers(): Promise<RawSnapshot[]> {
  const data = await polygonGet<{ tickers?: SnapshotTicker[] }>(
    "/v2/snapshot/locale/us/markets/stocks/gainers",
  );
  return (data.tickers ?? []).map(toRaw).filter((r): r is RawSnapshot => r !== null);
}

export async function fetchSingleSnapshot(ticker: string): Promise<RawSnapshot | null> {
  try {
    const data = await polygonGet<{ ticker?: SnapshotTicker }>(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`,
    );
    return data.ticker ? toRaw(data.ticker) : null;
  } catch {
    return null;
  }
}

export async function fetchPolygonReference(ticker: string): Promise<ReferenceData | null> {
  try {
    const data = await polygonGet<{ results?: Record<string, unknown> }>(
      `/v3/reference/tickers/${encodeURIComponent(ticker)}`,
    );
    const r = data.results;
    if (!r) return null;
    return {
      ticker,
      type: typeof r.type === "string" ? r.type : null,
      name: typeof r.name === "string" ? r.name : null,
      marketCap: typeof r.market_cap === "number" ? r.market_cap : null,
      shareClassShares: typeof r.share_class_shares_outstanding === "number" ? r.share_class_shares_outstanding : null,
      weightedSharesOutstanding: typeof r.weighted_shares_outstanding === "number" ? r.weighted_shares_outstanding : null,
    };
  } catch {
    return null;
  }
}

export function formatMarketCap(n: number | null): string {
  if (n == null || n <= 0) return "";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

export function formatFloat(ref: ReferenceData): string {
  const s = ref.weightedSharesOutstanding ?? ref.shareClassShares;
  if (s == null || s <= 0) return "";
  if (s >= 1_000_000_000) return `${(s / 1_000_000_000).toFixed(2)}B`;
  if (s >= 1_000_000) return `${(s / 1_000_000).toFixed(1)}M`;
  return s.toLocaleString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseForceTickers(input: string | undefined): string[] {
  if (!input) return [];
  return Array.from(new Set(
    input
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z][A-Z0-9.]*$/.test(s)),
  ));
}

async function buildStock(raw: RawSnapshot, ref: ReferenceData | null): Promise<MorningEmailStock> {
  return {
    ticker: raw.ticker,
    name: ref?.name ?? "",
    change_pct: round2(raw.changePct),
    last: round2(raw.lastPrice),
    volume: raw.volume,
    market_cap: formatMarketCap(ref?.marketCap ?? null),
    float: ref ? formatFloat(ref) : "",
    catalyst: "",
    sentiment: "",
    evidence_notes: "",
    confidence: "",
    risk_flags: [],
    source_urls: [],
    evidence: [],
  };
}

export async function scanMorningMovers(opts: { forceTickers?: string }): Promise<ScanResult> {
  const qa: QaMessage[] = [];
  const forced = parseForceTickers(opts.forceTickers);

  if (!process.env.POLYGON_API_KEY) {
    qa.push({ level: "error", message: "POLYGON_API_KEY missing — cannot scan movers." });
    return { stocks: [], qa, live: false };
  }

  if (forced.length > 0) {
    const stocks: MorningEmailStock[] = [];
    for (const ticker of forced) {
      const [snap, ref] = await Promise.all([
        fetchSingleSnapshot(ticker),
        fetchPolygonReference(ticker),
      ]);
      if (!snap) {
        qa.push({ level: "warning", message: `${ticker}: no snapshot data; included with empty price/volume.` });
      }
      const raw: RawSnapshot = snap ?? { ticker, changePct: 0, lastPrice: 0, volume: 0 };
      stocks.push(await buildStock(raw, ref));
    }
    qa.push({ level: "ok", message: `Forced ${stocks.length} ticker${stocks.length === 1 ? "" : "s"} (filters skipped).` });
    return { stocks, qa, live: false };
  }

  let candidates: RawSnapshot[];
  try {
    candidates = await fetchPolygonGainers();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    qa.push({ level: "error", message: `Polygon gainers fetch failed: ${msg}` });
    return { stocks: [], qa, live: false };
  }

  const stocks: MorningEmailStock[] = [];
  for (const c of candidates) {
    if (stocks.length >= TARGET_STOCKS) break;

    if (WARRANT_SUFFIX.test(c.ticker)) {
      qa.push({ level: "warning", message: `Skipped ${c.ticker} — warrant-like suffix.` });
      continue;
    }
    if (c.changePct <= 0) {
      qa.push({ level: "warning", message: `Skipped ${c.ticker} — non-positive mover (${c.changePct.toFixed(2)}%).` });
      continue;
    }
    if (c.lastPrice <= 0.1) {
      qa.push({ level: "warning", message: `Skipped ${c.ticker} — price ≤ $0.10 ($${c.lastPrice}).` });
      continue;
    }

    const ref = await fetchPolygonReference(c.ticker);
    if (ref?.type !== "CS") {
      qa.push({ level: "warning", message: `Skipped ${c.ticker} — not common stock (type=${ref?.type ?? "unknown"}).` });
      continue;
    }

    stocks.push(await buildStock(c, ref));
  }

  if (stocks.length < TARGET_STOCKS) {
    qa.push({ level: "warning", message: `Returned ${stocks.length}/${TARGET_STOCKS} movers after filtering.` });
  } else {
    qa.push({ level: "ok", message: `Returned ${TARGET_STOCKS} common-stock movers.` });
  }

  return { stocks, qa, live: true };
}
