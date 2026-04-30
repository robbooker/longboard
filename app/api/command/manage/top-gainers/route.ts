import { NextResponse } from "next/server";

const POLYGON_BASE = "https://api.polygon.io";

type PolygonTickerSnapshot = {
  ticker?: string;
  todaysChangePerc?: number;
  day?: { c?: number; v?: number };
  prevDay?: { c?: number };
  min?: { c?: number; v?: number };
};

function filterTicker(ticker?: string) {
  if (!ticker) return false;
  // Keep it simple: common stock tickers only, skip weird units/warrants.
  return /^[A-Z]{1,5}$/.test(ticker);
}

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Polygon API key not configured" }, { status: 500 });

  try {
    // Market-hours "top gainers" endpoint; we only return top 4 to keep the
    // display consistent for all users (and avoid arbitrary ticker selection).
    const res = await fetch(`${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${apiKey}`, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `Polygon returned ${res.status}: ${body}` }, { status: 500 });
    }

    const data = await res.json();
    const tickers: PolygonTickerSnapshot[] = Array.isArray(data?.tickers) ? data.tickers : [];
    const out = tickers.filter((t) => filterTicker(t.ticker)).slice(0, 4);

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      tickers: out,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

const POLYGON_BASE = "https://api.polygon.io";

type PolygonTickerSnapshot = {
  ticker?: string;
  todaysChangePerc?: number;
  day?: { c?: number; v?: number };
  prevDay?: { c?: number };
  min?: { c?: number; v?: number };
};

function filterTicker(ticker?: string) {
  if (!ticker) return false;
  // Keep it simple: common stock tickers only, skip weird units/warrants.
  return /^[A-Z]{1,5}$/.test(ticker);
}

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Polygon API key not configured" }, { status: 500 });

  try {
    // Market-hours "top gainers" endpoint; we only return top 4 to keep the
    // display consistent for all users (and avoid arbitrary ticker selection).
    const res = await fetch(`${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${apiKey}`, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `Polygon returned ${res.status}: ${body}` }, { status: 500 });
    }

    const data = await res.json();
    const tickers: PolygonTickerSnapshot[] = Array.isArray(data?.tickers) ? data.tickers : [];
    const out = tickers.filter((t) => filterTicker(t.ticker)).slice(0, 4);

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      tickers: out,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

