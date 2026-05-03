import { emptyPriceTargets, type MorningEmailStock, type QaMessage, type ResearchSource } from "./types";

// TODO(consolidation): polygonGet + nyClockToUtcMs + nyDateParts below are
// duplicated in lib/polygon/client.ts (chart prototype). Consolidate into
// a single module in a follow-up cleanup PR.

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
};

export type ScanResult = {
  stocks: MorningEmailStock[];
  qa: QaMessage[];
  live: boolean;
};

const TARGET_STOCKS = 5;

const WARRANT_SUFFIX = /(?:WS|WT|W)$/;

const NY_TZ = "America/New_York";

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
  return {
    ticker: t.ticker,
    changePct: t.todaysChangePerc ?? 0,
    lastPrice,
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

export async function fetchPolygonNews(ticker: string): Promise<ResearchSource[]> {
  try {
    const data = await polygonGet<{ results?: Array<{ title?: string; description?: string; article_url?: string; published_utc?: string }> }>(
      `/v2/reference/news?ticker=${encodeURIComponent(ticker)}&limit=10&order=desc&sort=published_utc`,
    );
    const items = data.results ?? [];
    return items.slice(0, 6).map((r): ResearchSource => ({
      source: "Polygon News",
      title: r.title ?? "",
      text: r.description ?? "",
      url: r.article_url,
      publishedAt: r.published_utc,
    }));
  } catch {
    return [];
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

function nyDateParts(d: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallAsUtc - utcMs;
}

function nyClockToUtcMs(year: number, month: number, day: number, hour: number, minute: number): number {
  // Two-step iteration so DST transitions resolve to the correct offset.
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const provisional = guess - tzOffsetMs(guess, NY_TZ);
  const offset = tzOffsetMs(provisional, NY_TZ);
  return guess - offset;
}

export async function fetchPreMarketVolume(ticker: string): Promise<number> {
  const now = new Date();
  const { year, month, day } = nyDateParts(now);
  const fromMs = nyClockToUtcMs(year, month, day, 4, 0);
  const marketOpenMs = nyClockToUtcMs(year, month, day, 9, 30);
  // Cap at 09:29:59.999 ET so the 09:30 regular-session bar can't bleed in.
  const toMs = Math.min(now.getTime(), marketOpenMs - 1);
  if (toMs < fromMs) return 0;

  const path =
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${fromMs}/${toMs}` +
    `?adjusted=true&extended_hours=true&sort=asc&limit=50000`;
  const data = await polygonGet<{ results?: Array<{ v?: number }> }>(path);
  return (data.results ?? []).reduce(
    (sum, b) => sum + (typeof b.v === "number" ? b.v : 0),
    0,
  );
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

function buildStock(raw: RawSnapshot, ref: ReferenceData | null, volume: number): MorningEmailStock {
  return {
    ticker: raw.ticker,
    name: ref?.name ?? "",
    change_pct: round2(raw.changePct),
    last: round2(raw.lastPrice),
    volume,
    market_cap: formatMarketCap(ref?.marketCap ?? null),
    float: ref ? formatFloat(ref) : "",
    catalyst: [],
    sentiment: "",
    evidence_notes: "",
    confidence: "",
    risk_flags: [],
    source_urls: [],
    evidence: [],
    price_targets: emptyPriceTargets(),
  };
}

async function safePreMarketVolume(ticker: string, qa: QaMessage[]): Promise<number> {
  try {
    return await fetchPreMarketVolume(ticker);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    qa.push({ level: "warning", message: `${ticker}: pre-market volume fetch failed (${msg}); rendering "—".` });
    return 0;
  }
}

export async function scanMorningMovers(opts: { forceTickers?: string }): Promise<ScanResult> {
  const qa: QaMessage[] = [];
  const forced = parseForceTickers(opts.forceTickers);

  if (!process.env.POLYGON_API_KEY) {
    qa.push({ level: "error", message: "POLYGON_API_KEY missing — cannot scan movers." });
    return { stocks: [], qa, live: false };
  }

  if (forced.length > 0) {
    const stocks = await Promise.all(
      forced.map(async (ticker) => {
        const [snap, ref, volume] = await Promise.all([
          fetchSingleSnapshot(ticker),
          fetchPolygonReference(ticker),
          safePreMarketVolume(ticker, qa),
        ]);
        if (!snap) {
          qa.push({ level: "warning", message: `${ticker}: no snapshot data; included with empty price/volume.` });
        }
        const raw: RawSnapshot = snap ?? { ticker, changePct: 0, lastPrice: 0 };
        return buildStock(raw, ref, volume);
      }),
    );
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

  const picked: Array<{ raw: RawSnapshot; ref: ReferenceData }> = [];
  for (const c of candidates) {
    if (picked.length >= TARGET_STOCKS) break;

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

    picked.push({ raw: c, ref });
  }

  const volumes = await Promise.all(picked.map(({ raw }) => safePreMarketVolume(raw.ticker, qa)));
  const stocks = picked.map(({ raw, ref }, i) => buildStock(raw, ref, volumes[i]));

  if (stocks.length < TARGET_STOCKS) {
    qa.push({ level: "warning", message: `Returned ${stocks.length}/${TARGET_STOCKS} movers after filtering.` });
  } else {
    qa.push({ level: "ok", message: `Returned ${TARGET_STOCKS} common-stock movers.` });
  }

  return { stocks, qa, live: true };
}
