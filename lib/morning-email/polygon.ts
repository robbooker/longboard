import { emptyPriceTargets, type MorningEmailStock, type QaMessage, type ResearchSource } from "./types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// TODO(consolidation): polygonGet + nyClockToUtcMs + nyDateParts below are
// duplicated in lib/polygon/client.ts (chart prototype). Consolidate into
// a single module in a follow-up cleanup PR.

const POLYGON_BASE = "https://api.polygon.io";

type SnapshotTicker = {
  ticker?: string;
  todaysChangePerc?: number;
  todaysChange?: number;
  day?: { c?: number; v?: number };
  prevDay?: { c?: number };
  lastTrade?: { p?: number; t?: number };
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
  dollarChange: number;
  lastPrice: number;
  volume: number;
  providerUpdatedAt: string | null;
};

type ScannerSeenRow = {
  ticker: string;
  name: string;
  price: number;
  day_gain_pct: number;
  day_volume: number;
  market_cap: number;
  first_seen_at: string;
  last_seen_at: string;
  appearances: number;
};

type TradepodTopStock = ScannerSeenRow & {
  updated_at?: string;
};

type TradepodTopStocksResponse = {
  source?: string;
  snapshotId?: string;
  heartbeatAt?: string;
  ageMinutes?: number | null;
  stale?: boolean;
  runtime?: { message?: string; status?: string } | null;
  stocks?: TradepodTopStock[];
  error?: string;
};

export type ScanResult = {
  stocks: MorningEmailStock[];
  qa: QaMessage[];
  live: boolean;
};

const TARGET_STOCKS = 5;

const WARRANT_SUFFIX = /(?:WS|WT|W)$/;
const MIN_PRICE = 1;
const MAX_PRICE = 20;
const MIN_DAY_GAIN_PCT = 30;
const MIN_DAY_VOLUME = 500_000;
const MAX_MARKET_CAP = 100_000_000;
const LOCAL_RVOL_DB =
  process.env.LONGBOARD_RVOL_DB ||
  "/Users/robbooker/.local/share/ops-dashboard/codex_rvol_live.sqlite3";
const TRADEPOD_TOP_STOCKS_URL =
  process.env.TRADEPOD_RVOL_TOP_STOCKS_URL ||
  "https://tradepod.ai/api/scanner/rvol/top-stocks";

const NY_TZ = "America/New_York";
const execFileAsync = promisify(execFile);

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
  const lastPrice = t.day?.c ?? t.lastTrade?.p ?? 0;
  const prevClose = t.prevDay?.c ?? 0;
  const fallbackChangePct = prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : 0;
  const fallbackDollarChange = prevClose > 0 ? lastPrice - prevClose : 0;
  const tradeTs = typeof t.lastTrade?.t === "number" ? t.lastTrade.t : null;
  return {
    ticker: t.ticker,
    changePct: t.todaysChangePerc ?? fallbackChangePct,
    dollarChange: t.todaysChange ?? fallbackDollarChange,
    lastPrice,
    volume: t.day?.v ?? 0,
    providerUpdatedAt: tradeTs ? new Date(tradeTs / 1_000_000).toISOString() : null,
  };
}

export async function fetchPolygonGainers(): Promise<RawSnapshot[]> {
  const data = await polygonGet<{ tickers?: SnapshotTicker[] }>(
    "/v2/snapshot/locale/us/markets/stocks/gainers",
  );
  return (data.tickers ?? []).map(toRaw).filter((r): r is RawSnapshot => r !== null);
}

export async function fetchPolygonTickerSnapshots(): Promise<RawSnapshot[]> {
  const data = await polygonGet<{ tickers?: SnapshotTicker[] }>(
    "/v2/snapshot/locale/us/markets/stocks/tickers",
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

function isLikelySpac(name: string, sicCode?: string | null): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.includes("acquisition") ||
    normalized.includes("blank check") ||
    normalized.includes("spac") ||
    sicCode === "6770"
  );
}

async function fetchLocalScannerSeenToday(limit: number): Promise<ScannerSeenRow[]> {
  const safeLimit = Math.max(1, Math.min(50, limit));
  const { year, month, day } = nyDateParts(new Date());
  const marketDay = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const sessionStartIso = new Date(nyClockToUtcMs(year, month, day, 4, 0)).toISOString();
  const sql = `
    select ticker, name, price, day_gain_pct, day_volume, market_cap, first_seen_at, last_seen_at, appearances
    from scanner_seen
    where trading_day = '${marketDay}'
      and last_seen_at >= '${sessionStartIso}'
    order by day_gain_pct desc, appearances desc
    limit ${safeLimit}
  `;
  try {
    const { stdout } = await execFileAsync("sqlite3", [LOCAL_RVOL_DB, "-json", sql], { timeout: 2_000 });
    const rows = JSON.parse(stdout || "[]") as Array<Record<string, unknown>>;
    return rows
      .map((row) => ({
        ticker: String(row.ticker || "").toUpperCase(),
        name: String(row.name || ""),
        price: Number(row.price || 0),
        day_gain_pct: Number(row.day_gain_pct || 0),
        day_volume: Number(row.day_volume || 0),
        market_cap: Number(row.market_cap || 0),
        first_seen_at: String(row.first_seen_at || ""),
        last_seen_at: String(row.last_seen_at || ""),
        appearances: Number(row.appearances || 0),
      }))
      .filter((row) => row.ticker);
  } catch {
    return [];
  }
}

function buildStock(raw: RawSnapshot, ref: ReferenceData | null, volume: number): MorningEmailStock {
  return {
    ticker: raw.ticker,
    name: ref?.name ?? "",
    change_pct: round2(raw.changePct),
    dollar_change: round2(raw.dollarChange),
    last: round2(raw.lastPrice),
    volume,
    market_cap: formatMarketCap(ref?.marketCap ?? null),
    float: ref ? formatFloat(ref) : "",
    provider_updated_at: raw.providerUpdatedAt,
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

function buildStockFromScannerRow(row: ScannerSeenRow, sourceLabel: string): MorningEmailStock {
  const stock = buildStock(
    {
      ticker: row.ticker,
      changePct: row.day_gain_pct,
      dollarChange: 0,
      lastPrice: row.price,
      volume: row.day_volume,
      providerUpdatedAt: row.last_seen_at || null,
    },
    {
      ticker: row.ticker,
      type: "CS",
      name: row.name,
      marketCap: row.market_cap,
      shareClassShares: null,
      weightedSharesOutstanding: null,
    },
    row.day_volume,
  );
  stock.evidence_notes = `Notable earlier today: the ${sourceLabel} saw this name ${row.appearances.toLocaleString()} time${row.appearances === 1 ? "" : "s"}. First seen ${row.first_seen_at || "today"}; last seen ${row.last_seen_at || "today"}.`;
  return stock;
}

async function fetchTradepodScannerStocks(limit: number, qa: QaMessage[]): Promise<MorningEmailStock[]> {
  const secret = process.env.TRADEPOD_RVOL_READ_SECRET;
  if (!TRADEPOD_TOP_STOCKS_URL || !secret) {
    qa.push({ level: "warning", message: "TradePod RVOL scanner feed is not configured; falling back to Longboard/Polygon scan." });
    return [];
  }

  const url = new URL(TRADEPOD_TOP_STOCKS_URL);
  url.searchParams.set("limit", String(Math.max(1, Math.min(10, limit))));
  url.searchParams.set("maxAgeMinutes", process.env.TRADEPOD_RVOL_MAX_AGE_MINUTES || "240");

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as TradepodTopStocksResponse;
    if (!response.ok) {
      qa.push({ level: "warning", message: `TradePod RVOL scanner feed failed: ${payload.error || `HTTP ${response.status}`}. Falling back to Longboard/Polygon scan.` });
      return [];
    }
    if (payload.stale && process.env.TRADEPOD_RVOL_ALLOW_STALE !== "true") {
      qa.push({ level: "warning", message: `TradePod RVOL scanner feed is stale (${payload.ageMinutes ?? "unknown"} minutes old); falling back to Longboard/Polygon scan.` });
      return [];
    }
    const stocks = (payload.stocks || [])
      .slice(0, limit)
      .map((row) => buildStockFromScannerRow({
        ticker: row.ticker,
        name: row.name,
        price: Number(row.price || 0),
        day_gain_pct: Number(row.day_gain_pct || 0),
        day_volume: Number(row.day_volume || 0),
        market_cap: Number(row.market_cap || 0),
        first_seen_at: row.first_seen_at || row.updated_at || "",
        last_seen_at: row.last_seen_at || row.updated_at || "",
        appearances: Number(row.appearances || 1),
      }, "TradePod live RVOL scanner"));

    if (stocks.length > 0) {
      qa.push({
        level: "ok",
        message: `Loaded ${stocks.length} morning name${stocks.length === 1 ? "" : "s"} from TradePod RVOL scanner (${payload.source || "latest snapshot"}${payload.ageMinutes == null ? "" : `, ${payload.ageMinutes}m old`}).`,
      });
    }
    return stocks;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    qa.push({ level: "warning", message: `TradePod RVOL scanner feed threw: ${msg}. Falling back to Longboard/Polygon scan.` });
    return [];
  }
}

export type LiveTickerRefresh =
  | { ok: true; ticker: string; patch: Partial<MorningEmailStock> }
  | { ok: false; ticker: string; error: string };

export async function refreshMorningReportTicker(ticker: string): Promise<LiveTickerRefresh> {
  const normalized = ticker.trim().toUpperCase();
  try {
    const [snap, ref] = await Promise.all([
      fetchSingleSnapshot(normalized),
      fetchPolygonReference(normalized),
    ]);
    if (!snap) return { ok: false, ticker: normalized, error: "no snapshot data" };
    return {
      ok: true,
      ticker: normalized,
      patch: {
        change_pct: round2(snap.changePct),
        dollar_change: round2(snap.dollarChange),
        last: round2(snap.lastPrice),
        volume: snap.volume,
        market_cap: formatMarketCap(ref?.marketCap ?? null),
        float: ref ? formatFloat(ref) : undefined,
        provider_updated_at: snap.providerUpdatedAt,
      },
    };
  } catch (e) {
    return {
      ok: false,
      ticker: normalized,
      error: e instanceof Error ? e.message : "unknown",
    };
  }
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

  if (forced.length === 0) {
    const tradepodStocks = await fetchTradepodScannerStocks(TARGET_STOCKS, qa);
    if (tradepodStocks.length > 0) {
      return { stocks: tradepodStocks, qa, live: true };
    }
  }

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
        const raw: RawSnapshot = snap ?? { ticker, changePct: 0, dollarChange: 0, lastPrice: 0, volume: 0, providerUpdatedAt: null };
        return buildStock(raw, ref, volume);
      }),
    );
    qa.push({ level: "ok", message: `Forced ${stocks.length} ticker${stocks.length === 1 ? "" : "s"} (filters skipped).` });
    return { stocks, qa, live: false };
  }

  let candidates: RawSnapshot[];
  try {
    candidates = await fetchPolygonTickerSnapshots();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    qa.push({ level: "error", message: `Polygon all-stock snapshot fetch failed: ${msg}` });
    return { stocks: [], qa, live: false };
  }

  const picked: Array<{ raw: RawSnapshot; ref: ReferenceData }> = [];
  const sortedCandidates = candidates
    .filter((c) => c.lastPrice >= MIN_PRICE && c.lastPrice <= MAX_PRICE)
    .filter((c) => c.changePct >= MIN_DAY_GAIN_PCT)
    .filter((c) => c.volume >= MIN_DAY_VOLUME)
    .sort((a, b) => b.changePct - a.changePct);

  for (const c of sortedCandidates) {
    if (picked.length >= TARGET_STOCKS) break;

    if (WARRANT_SUFFIX.test(c.ticker)) {
      qa.push({ level: "warning", message: `Skipped ${c.ticker} — warrant-like suffix.` });
      continue;
    }

    const ref = await fetchPolygonReference(c.ticker);
    if (ref?.type !== "CS") {
      qa.push({ level: "warning", message: `Skipped ${c.ticker} — not common stock (type=${ref?.type ?? "unknown"}).` });
      continue;
    }
    if (!ref.marketCap || ref.marketCap >= MAX_MARKET_CAP) {
      qa.push({ level: "warning", message: `Skipped ${c.ticker} — market cap outside RVOL universe (${formatMarketCap(ref.marketCap)}).` });
      continue;
    }
    if (isLikelySpac(ref.name ?? c.ticker)) {
      qa.push({ level: "warning", message: `Skipped ${c.ticker} — likely SPAC / blank-check name.` });
      continue;
    }

    picked.push({ raw: c, ref });
  }

  const volumes = await Promise.all(picked.map(({ raw }) => safePreMarketVolume(raw.ticker, qa)));
  const liveStocks = picked.map(({ raw, ref }, i) => buildStock(raw, ref, volumes[i]));
  const stocks = [...liveStocks];

  if (stocks.length < TARGET_STOCKS) {
    const seenRows = await fetchLocalScannerSeenToday(25);
    const alreadyPicked = new Set(stocks.map((stock) => stock.ticker));
    const notableEarlier = seenRows
      .filter((row) => !alreadyPicked.has(row.ticker))
      .slice(0, TARGET_STOCKS - stocks.length)
      .map((row) => {
        const stock = buildStockFromScannerRow(row, "local Longboard RVOL scanner journal");
        stock.risk_flags = ["Seen earlier today; may not still pass the live-now RVOL filter."];
        return stock;
      });

    stocks.push(...notableEarlier);
    if (notableEarlier.length > 0) {
      qa.push({
        level: "ok",
        message: `Added ${notableEarlier.length} notable earlier-today name${notableEarlier.length === 1 ? "" : "s"} from the local Longboard RVOL scanner journal.`,
      });
    }
  }

  if (stocks.length < TARGET_STOCKS) {
    qa.push({ level: "warning", message: `Returned ${stocks.length}/${TARGET_STOCKS} RVOL names after current scan plus local scanner journal backfill.` });
  } else {
    qa.push({ level: "ok", message: `Returned ${liveStocks.length} live-now Longboard RVOL name${liveStocks.length === 1 ? "" : "s"} and ${stocks.length - liveStocks.length} notable earlier-today name${stocks.length - liveStocks.length === 1 ? "" : "s"}. Universe: $${MIN_PRICE}-${MAX_PRICE}, >=${MIN_DAY_GAIN_PCT}% day gain, >=${MIN_DAY_VOLUME.toLocaleString()} volume, common stock, under ${formatMarketCap(MAX_MARKET_CAP)} market cap.` });
  }

  return { stocks, qa, live: true };
}
