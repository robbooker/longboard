import { NextResponse } from "next/server";
import type { PolygonTickerSnapshot } from "@/types/polygon";

const POLYGON_BASE = "https://api.polygon.io";

/** Small-cap band for the Phase 3E "Today's Small-Cap Movers" list.
 *  Wide on purpose — catches micro ($50M and under) through small ($2B)
 *  so momentum plays across the whole low-to-mid cap spectrum show up.
 *  Above $2B is mid-cap territory; below $20M is noise / halted /
 *  micro-penny. Adjust here if the band needs to shift. */
const SMALL_CAP_MIN = 20_000_000;    // $20M
const SMALL_CAP_MAX = 2_000_000_000; // $2B

/** Size of the pre-cap candidate pool. We filter by market-cap after the
 *  change-% filter, so we oversample to ~30 to leave room for non-small-
 *  caps to fall out while still landing roughly 10 in the final list. */
const CANDIDATE_POOL = 30;

/** Target size of the final returned list. Matches the pre-3E behavior. */
const FINAL_LIST_SIZE = 10;

/** Check if we're before regular market open (9:30 AM ET) */
function isPreMarket(): boolean {
  const et = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins < 570; // 9:30 AM = 570 mins
}

function isWeekend(): boolean {
  const et = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  const day = et.getDay();
  return day === 0 || day === 6;
}

function filterTicker(ticker: string): boolean {
  if (!ticker || typeof ticker !== "string") return false;
  if (/W$|WS$|WT$|R$|U$/i.test(ticker)) return false;
  if (ticker.includes(".")) return false;
  if (ticker.length > 5) return false;
  return true;
}

/** Fetch market cap for a single ticker from Polygon's reference endpoint.
 *  Returns null on any failure (network, 404 for delisted tickers, missing
 *  market_cap field for thinly-covered names). Callers treat null as "cap
 *  unknown → drop from small-cap list" — better than risking a mid-cap
 *  slipping in because its data is incomplete. */
async function fetchMarketCap(ticker: string, apiKey: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${POLYGON_BASE}/v3/reference/tickers/${ticker}?apiKey=${apiKey}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const cap = data?.results?.market_cap;
    return typeof cap === "number" && cap > 0 ? cap : null;
  } catch {
    return null;
  }
}

/** Enrich a list of candidate gainers with market_cap from Polygon, then
 *  keep only those inside the small-cap band and return the top N by
 *  whatever order the candidates arrived in (callers pre-sort by change%). */
async function filterToSmallCap(
  candidates: PolygonTickerSnapshot[],
  apiKey: string,
): Promise<PolygonTickerSnapshot[]> {
  const caps = await Promise.all(
    candidates.map((c) => fetchMarketCap(c.ticker, apiKey))
  );
  const withCap: PolygonTickerSnapshot[] = candidates.map((c, i) => ({
    ...c,
    marketCap: caps[i],
  }));
  return withCap.filter(
    (c) =>
      c.marketCap != null &&
      c.marketCap >= SMALL_CAP_MIN &&
      c.marketCap <= SMALL_CAP_MAX
  );
}

export async function GET() {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Polygon API key not configured" },
      { status: 500 }
    );
  }

  try {
    const preMarket = isPreMarket() || isWeekend();

    if (preMarket) {
      // ── Pre-market: fetch ALL ticker snapshots, compute gainers from lastTrade ──
      const res = await fetch(
        `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${apiKey}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Polygon returned ${res.status}: ${body}`);
      }

      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allTickers = (data.tickers || []) as any[];

      const candidates: PolygonTickerSnapshot[] = allTickers
        .filter((t) => {
          if (!filterTicker(t.ticker)) return false;
          const price = t.lastTrade?.p;
          const prevClose = t.prevDay?.c;
          if (!price || !prevClose || prevClose <= 0) return false;
          if (price < 1) return false;
          if (!t.min?.v || t.min.v < 1000) return false;
          const pct = ((price - prevClose) / prevClose) * 100;
          return pct > 5;
        })
        .map((t) => {
          const price = t.lastTrade.p as number;
          const prevClose = t.prevDay.c as number;
          const change = price - prevClose;
          const changePct = (change / prevClose) * 100;

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

      const smallCaps = await filterToSmallCap(candidates, apiKey);
      const preMarketGainers = smallCaps.slice(0, FINAL_LIST_SIZE);

      return NextResponse.json({
        tickers: preMarketGainers,
        fetchedAt: new Date().toISOString(),
        mode: "pre-market",
      });
    } else {
      // ── Regular hours: use the gainers endpoint ──
      const res = await fetch(
        `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${apiKey}`,
        { cache: "no-store" }
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
      const tickers = smallCaps.slice(0, FINAL_LIST_SIZE);

      return NextResponse.json({
        tickers,
        fetchedAt: new Date().toISOString(),
        mode: "market",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Polygon API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
