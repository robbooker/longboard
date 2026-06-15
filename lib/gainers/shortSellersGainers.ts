import type { GainersData, PolygonTickerSnapshot } from "@/types/polygon";

type SessionMode = NonNullable<GainersData["mode"]>;
type ActiveSessionMode = Exclude<SessionMode, "closed">;
type RawTicker = Record<string, any>;
type JsonObject = Record<string, unknown>;

const POLYGON_BASE = "https://api.polygon.io";
const ASKEDGAR_BASE_URL = process.env.ASKEDGAR_API_BASE_URL || process.env.ASKEDGAR_BASE_URL || "https://eapi.askedgar.io";
const NY_TZ = "America/New_York";

const DEFAULT_MIN_CHANGE_PCT = 25;
const DEFAULT_EXTENDED_MIN_CHANGE_PCT = 20;
const DEFAULT_MIN_PRICE = 0.8;
const DEFAULT_MIN_VOLUME = 100_000;
const DEFAULT_EXTENDED_MIN_VOLUME = 50_000;
const DEFAULT_MAX_MARKET_CAP = 2_000_000_000;
const DEFAULT_CANDIDATE_POOL = 100;
const DEFAULT_FINAL_LIST_SIZE = 20;

type ShortSellersCandidate = {
  ticker: string;
  price: number;
  change: number;
  changePct: number;
  sessionChangePct: number;
  dayChangePct: number;
  open: number;
  previousClose: number;
  regularClose: number;
  highOfDay: number;
  volume: number;
  updated: number;
  session: ActiveSessionMode;
  alertPriority: number;
  raw: RawTicker;
};

type ShareData = {
  sharesOutstanding: number | null;
  cachedMarketCap: number | null;
};

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function easternMinuteOfDay(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function easternDayOfWeek(date = new Date()): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "short",
  }).format(date);
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return days[label] ?? date.getDay();
}

function shortSellersSession(now = new Date()): SessionMode {
  const day = easternDayOfWeek(now);
  const minute = easternMinuteOfDay(now);

  if (day === 0 || day === 6) return "closed";
  if (minute < 4 * 60 || minute >= 20 * 60) return "closed";
  if (minute < 9 * 60 + 30) return "pre-market";
  if (minute >= 16 * 60) return "post-market";
  return "market";
}

function resolveSession(requested: string | undefined, now = new Date()): SessionMode {
  if (requested === "pre") return "pre-market";
  if (requested === "post") return "post-market";
  if (requested === "market") return "market";
  return shortSellersSession(now);
}

function isLikelyOperatingCommonStockSymbol(ticker = ""): boolean {
  if (!ticker || ticker.length > 5 || ticker.includes(".")) return false;
  return !/(W|WS|WT|R|U)$/i.test(ticker);
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(typeof value === "string" ? value.replace(/[$,%\s,]/g, "") : value);
  return Number.isFinite(number) ? number : null;
}

function field(record: JsonObject | null, keys: string[]): unknown {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function firstObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    return value.find((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)) ?? null;
  }

  const object = value as JsonObject;
  for (const key of ["data", "result", "results", "float_outstanding"]) {
    const nested = object[key];
    if (Array.isArray(nested)) {
      const found = nested.find((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item));
      if (found) return found;
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as JsonObject;
  }
  return object;
}

async function polygonFetchJson(path: string): Promise<JsonObject> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("POLYGON_API_KEY not configured");

  const url = new URL(`${POLYGON_BASE}${path}`);
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.status === "ERROR") {
    throw new Error(`Polygon returned ${response.status}: ${body?.error || body?.message || path}`);
  }
  return body as JsonObject;
}

async function fetchTickerReference(ticker: string): Promise<JsonObject | null> {
  try {
    const data = await polygonFetchJson(`/v3/reference/tickers/${encodeURIComponent(ticker)}`);
    return (data.results && typeof data.results === "object" && !Array.isArray(data.results))
      ? data.results as JsonObject
      : null;
  } catch {
    return null;
  }
}

async function askEdgarFetch(path: string, ticker: string): Promise<JsonObject | null> {
  const apiKey = process.env.ASKEDGAR_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const url = new URL(`${ASKEDGAR_BASE_URL.replace(/\/+$/, "")}${path}`);
    url.searchParams.set("ticker", ticker);
    url.searchParams.set("limit", "1");

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "API-KEY": apiKey,
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    return firstObject(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

async function fetchShareData(ticker: string): Promise<ShareData> {
  const floatRecord = await askEdgarFetch("/v1/float-outstanding", ticker);
  return {
    sharesOutstanding: optionalNumber(field(floatRecord, ["outstanding", "shares_outstanding", "weighted_shares"])),
    cachedMarketCap: optionalNumber(field(floatRecord, ["market_cap_final", "market_cap"])),
  };
}

function normalizeSnapshotCandidate(raw: RawTicker, session: ActiveSessionMode): ShortSellersCandidate | null {
  const ticker = String(raw?.ticker || "").toUpperCase();
  const price = Number(raw?.lastTrade?.p || raw?.min?.c || raw?.day?.c);
  const previousClose = Number(raw?.prevDay?.c);
  const regularClose = Number(raw?.day?.c);
  const sessionBaseline = session === "post-market" ? regularClose : previousClose;

  if (!ticker || !Number.isFinite(price) || !Number.isFinite(sessionBaseline) || sessionBaseline <= 0) {
    return null;
  }

  const sessionChange = price - sessionBaseline;
  const sessionChangePct =
    Number.isFinite(Number(raw?.todaysChangePerc)) && session === "market"
      ? Number(raw.todaysChangePerc)
      : (sessionChange / sessionBaseline) * 100;
  const dayChangePct =
    Number.isFinite(price) && Number.isFinite(previousClose) && previousClose > 0
      ? ((price - previousClose) / previousClose) * 100
      : sessionChangePct;

  return {
    ticker,
    price,
    change: sessionChange,
    changePct: sessionChangePct,
    sessionChangePct,
    dayChangePct,
    open: Number(raw?.day?.o),
    previousClose,
    regularClose,
    highOfDay: Number(raw?.day?.h || price),
    volume: Number(raw?.day?.v || raw?.min?.av || raw?.min?.v),
    updated: Number(raw?.updated || raw?.lastTrade?.t || raw?.min?.t || 0),
    session,
    alertPriority: 1,
    raw,
  };
}

async function fetchShortSellersCandidates(session: ActiveSessionMode): Promise<ShortSellersCandidate[]> {
  const minChangePct = envNumber("SHORTSELLERS_GAINERS_MIN_CHANGE_PCT", DEFAULT_MIN_CHANGE_PCT);
  const extendedMinChangePct = envNumber("SHORTSELLERS_GAINERS_EXTENDED_MIN_CHANGE_PCT", DEFAULT_EXTENDED_MIN_CHANGE_PCT);
  const minPrice = envNumber("SHORTSELLERS_GAINERS_MIN_PRICE", DEFAULT_MIN_PRICE);
  const minVolume = envNumber("SHORTSELLERS_GAINERS_MIN_VOLUME", DEFAULT_MIN_VOLUME);
  const extendedMinVolume = envNumber("SHORTSELLERS_GAINERS_EXTENDED_MIN_VOLUME", DEFAULT_EXTENDED_MIN_VOLUME);
  const candidatePool = envNumber("SHORTSELLERS_GAINERS_CANDIDATE_POOL", DEFAULT_CANDIDATE_POOL);
  const snapshotPath =
    session === "market"
      ? "/v2/snapshot/locale/us/markets/stocks/gainers"
      : "/v2/snapshot/locale/us/markets/stocks/tickers";
  const data = await polygonFetchJson(snapshotPath);
  const rawTickers = Array.isArray(data.tickers) ? data.tickers as RawTicker[] : [];

  return rawTickers
    .map((item) => normalizeSnapshotCandidate(item, session))
    .filter((item): item is ShortSellersCandidate => Boolean(item))
    .filter((item) => isLikelyOperatingCommonStockSymbol(item.ticker))
    .filter((item) => item.price >= minPrice)
    .filter((item) =>
      session === "market"
        ? item.changePct >= minChangePct
        : item.sessionChangePct >= extendedMinChangePct || item.dayChangePct >= minChangePct,
    )
    .filter((item) =>
      Number.isFinite(item.volume) &&
      item.volume >= (session === "market" ? minVolume : extendedMinVolume),
    )
    .map((item) => ({
      ...item,
      changePct:
        session === "post-market" && item.sessionChangePct >= extendedMinChangePct
          ? item.sessionChangePct
          : item.dayChangePct,
      alertPriority: session !== "market" && item.sessionChangePct >= extendedMinChangePct ? 2 : 1,
    }))
    .sort((a, b) => b.alertPriority - a.alertPriority || b.changePct - a.changePct)
    .slice(0, candidatePool);
}

async function enrichShortSellersCandidate(candidate: ShortSellersCandidate): Promise<PolygonTickerSnapshot | null> {
  const [reference, shareData] = await Promise.all([
    fetchTickerReference(candidate.ticker),
    fetchShareData(candidate.ticker),
  ]);

  const type = String(reference?.type || "").toUpperCase();
  if (type && type !== "CS") return null;

  const fallbackMarketCap = optionalNumber(reference?.market_cap);
  const sharesOutstanding = shareData.sharesOutstanding;
  const cachedMarketCap = shareData.cachedMarketCap;
  const dynamicMarketCap =
    sharesOutstanding !== null && Number.isFinite(sharesOutstanding) && sharesOutstanding > 0
      ? sharesOutstanding * candidate.price
      : null;
  const marketCap =
    dynamicMarketCap ??
    (cachedMarketCap !== null && Number.isFinite(cachedMarketCap) && cachedMarketCap > 0 ? cachedMarketCap : null) ??
    (fallbackMarketCap !== null && Number.isFinite(fallbackMarketCap) && fallbackMarketCap > 0 ? fallbackMarketCap : null);
  const maxMarketCap = envNumber("SHORTSELLERS_GAINERS_MAX_MARKET_CAP", DEFAULT_MAX_MARKET_CAP);
  if (Number.isFinite(marketCap) && marketCap !== null && marketCap > maxMarketCap) return null;

  return {
    ticker: candidate.ticker,
    todaysChange: candidate.change,
    todaysChangePerc: candidate.changePct,
    updated: candidate.updated,
    day: {
      o: Number.isFinite(candidate.open) ? candidate.open : 0,
      h: Number.isFinite(candidate.highOfDay) ? candidate.highOfDay : candidate.price,
      l: Number(candidate.raw?.day?.l || candidate.price),
      c: candidate.price,
      v: Number.isFinite(candidate.volume) ? candidate.volume : 0,
      vw: Number(candidate.raw?.day?.vw || 0),
    },
    prevDay: {
      o: Number(candidate.raw?.prevDay?.o || 0),
      h: Number(candidate.raw?.prevDay?.h || 0),
      l: Number(candidate.raw?.prevDay?.l || 0),
      c: candidate.previousClose,
      v: Number(candidate.raw?.prevDay?.v || 0),
      vw: Number(candidate.raw?.prevDay?.vw || 0),
    },
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
    companyName: typeof reference?.name === "string" ? reference.name : null,
  };
}

export type FetchShortSellersGainersOptions = {
  limit?: number;
  session?: "auto" | "pre" | "market" | "post";
  now?: Date;
};

export async function fetchShortSellersGainers(opts: FetchShortSellersGainersOptions = {}): Promise<GainersData> {
  const limit = opts.limit ?? DEFAULT_FINAL_LIST_SIZE;
  const session = resolveSession(opts.session ?? "auto", opts.now);

  if (session === "closed") {
    return {
      tickers: [],
      fetchedAt: new Date().toISOString(),
      mode: "closed",
    };
  }

  const candidates = await fetchShortSellersCandidates(session);
  const enriched: PolygonTickerSnapshot[] = [];

  for (const candidate of candidates) {
    if (enriched.length >= limit) break;
    const row = await enrichShortSellersCandidate(candidate);
    if (row) enriched.push(row);
  }

  return {
    tickers: enriched,
    fetchedAt: new Date().toISOString(),
    mode: session,
  };
}
