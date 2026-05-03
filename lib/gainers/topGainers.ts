// TODO(consolidation): the fetch + small-cap-filter logic below is
// duplicated from app/api/gainers/route.ts. Duplication is intentional
// for the chart watchlist (feat/chart-watchlist) — keeps the live
// dashboard's API route untouched. Consolidate into a single shared
// module in a follow-up cleanup PR; both this file and route.ts should
// import from one source.

import type { GainersData, PolygonTickerSnapshot } from "@/types/polygon";

const POLYGON_BASE = "https://api.polygon.io";

const SMALL_CAP_MIN = 20_000_000;
const SMALL_CAP_MAX = 2_000_000_000;
const CANDIDATE_POOL = 30;
const FINAL_LIST_SIZE = 10;

const NY_TZ = "America/New_York";

function etMinutesNow(now: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

function etDayOfWeek(now: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "short",
  });
  const wk = fmt.format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wk] ?? new Date(now).getDay();
}

function isPreMarket(now: Date): boolean {
  return etMinutesNow(now) < 570;
}

function isAfterHours(now: Date): boolean {
  return etMinutesNow(now) >= 960;
}

function isWeekend(now: Date): boolean {
  const d = etDayOfWeek(now);
  return d === 0 || d === 6;
}

function filterTicker(ticker: string): boolean {
  if (!ticker || typeof ticker !== "string") return false;
  if (/W$|WS$|WT$|R$|U$/i.test(ticker)) return false;
  if (ticker.includes(".")) return false;
  if (ticker.length > 5) return false;
  return true;
}

async function fetchMarketCap(ticker: string, apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${POLYGON_BASE}/v3/reference/tickers/${ticker}?apiKey=${apiKey}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const cap = data?.results?.market_cap;
    return typeof cap === "number" && cap > 0 ? cap : null;
  } catch {
    return null;
  }
}

async function filterToSmallCap(
  candidates: PolygonTickerSnapshot[],
  apiKey: string,
): Promise<PolygonTickerSnapshot[]> {
  const caps = await Promise.all(
    candidates.map((c) => fetchMarketCap(c.ticker, apiKey)),
  );
  const withCap: PolygonTickerSnapshot[] = candidates.map((c, i) => ({
    ...c,
    marketCap: caps[i],
  }));
  return withCap.filter(
    (c) =>
      c.marketCap != null &&
      c.marketCap >= SMALL_CAP_MIN &&
      c.marketCap <= SMALL_CAP_MAX,
  );
}

async function fetchSnapshotComputedGainers(
  apiKey: string,
  opts: { baseline: "prev_close" | "regular_close" },
): Promise<PolygonTickerSnapshot[]> {
  const res = await fetch(
    `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${apiKey}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polygon returned ${res.status}: ${body}`);
  }
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTickers = (data.tickers || []) as any[];

  return allTickers
    .filter((t) => {
      if (!filterTicker(t.ticker)) return false;
      const price = t.lastTrade?.p;
      const baseline = opts.baseline === "regular_close" ? t.day?.c : t.prevDay?.c;
      if (!price || !baseline || baseline <= 0) return false;
      if (price < 1) return false;
      if (!t.min?.v || t.min.v < 1000) return false;
      const pct = ((price - baseline) / baseline) * 100;
      return pct > 5;
    })
    .map((t) => {
      const price = t.lastTrade.p as number;
      const baseline =
        opts.baseline === "regular_close" ? (t.day?.c as number) : (t.prevDay?.c as number);
      const change = price - baseline;
      const changePct = (change / baseline) * 100;
      return {
        ticker: t.ticker,
        todaysChange: change,
        todaysChangePerc: changePct,
        updated: t.updated,
        day: {
          o: t.day?.o || 0,
          h: price,
          l: price,
          c: price,
          v: t.min?.v || 0,
          vw: t.day?.vw || 0,
        },
        prevDay: t.prevDay,
      } as PolygonTickerSnapshot;
    })
    .sort((a, b) => b.todaysChangePerc - a.todaysChangePerc)
    .slice(0, CANDIDATE_POOL);
}

export type FetchTopGainersOptions = {
  limit?: number;
  session?: "auto" | "pre" | "market" | "post";
  now?: Date;
};

/**
 * Fetch the top US small-cap gainers from Polygon, filtered to the
 * $20M–$2B market-cap band. Mirrors app/api/gainers/route.ts.
 *
 * Auto-detects pre-market / regular / post-market session based on ET
 * clock + day-of-week. Override with `session` for testing or to force.
 */
export async function fetchTopGainers(opts: FetchTopGainersOptions = {}): Promise<GainersData> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("POLYGON_API_KEY not configured");

  const limit = opts.limit ?? FINAL_LIST_SIZE;
  const now = opts.now ?? new Date();
  const requested = (opts.session ?? "auto").toLowerCase();
  const autoPre = isPreMarket(now) || isWeekend(now);
  const autoPost = isAfterHours(now);

  const mode: "pre-market" | "market" | "post-market" =
    requested === "pre"
      ? "pre-market"
      : requested === "post"
        ? "post-market"
        : requested === "market"
          ? "market"
          : autoPre
            ? "pre-market"
            : autoPost
              ? "post-market"
              : "market";

  if (mode === "pre-market" || mode === "post-market") {
    const candidates = await fetchSnapshotComputedGainers(apiKey, {
      baseline: mode === "post-market" ? "regular_close" : "prev_close",
    });
    const smallCaps = await filterToSmallCap(candidates, apiKey);
    return {
      tickers: smallCaps.slice(0, limit),
      fetchedAt: new Date().toISOString(),
      mode,
    };
  }

  const res = await fetch(
    `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${apiKey}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polygon returned ${res.status}: ${body}`);
  }
  const data = await res.json();
  const candidates: PolygonTickerSnapshot[] = (data.tickers || [])
    .filter((t: PolygonTickerSnapshot) => {
      if (!filterTicker(t.ticker)) return false;
      if (t.day.c < 1) return false;
      return true;
    })
    .slice(0, CANDIDATE_POOL);

  const smallCaps = await filterToSmallCap(candidates, apiKey);
  return {
    tickers: smallCaps.slice(0, limit),
    fetchedAt: new Date().toISOString(),
    mode: "market",
  };
}
