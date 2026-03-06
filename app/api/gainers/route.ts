import { NextResponse } from "next/server";
import type { PolygonTickerSnapshot } from "@/types/polygon";

const POLYGON_BASE = "https://api.polygon.io";

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
      const allTickers = (data.tickers || []) as any[];

      const preMarketGainers = allTickers
        .filter((t) => {
          if (!filterTicker(t.ticker)) return false;
          const price = t.lastTrade?.p;
          const prevClose = t.prevDay?.c;
          if (!price || !prevClose || prevClose <= 0) return false;
          if (price < 1) return false;
          // Must have meaningful volume (at least 1000 shares in most recent min bar)
          if (!t.min?.v || t.min.v < 1000) return false;
          const pct = ((price - prevClose) / prevClose) * 100;
          return pct > 5;
        })
        .map((t: any) => {
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
        .sort(
          (a: PolygonTickerSnapshot, b: PolygonTickerSnapshot) =>
            b.todaysChangePerc - a.todaysChangePerc
        )
        .slice(0, 10);

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
      const tickers: PolygonTickerSnapshot[] = (data.tickers || [])
        .filter((t: PolygonTickerSnapshot) => {
          if (!filterTicker(t.ticker)) return false;
          if (t.day.c < 1) return false;
          return true;
        })
        .slice(0, 10);

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
