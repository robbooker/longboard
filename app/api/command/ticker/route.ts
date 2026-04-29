import { NextResponse, type NextRequest } from "next/server";
import type { PolygonTickerSnapshot } from "@/types/polygon";

const POLYGON_BASE = "https://api.polygon.io";

function cleanTicker(raw: string | null): string | null {
  const t = (raw || "").trim().toUpperCase();
  if (!t) return null;
  const safe = t.replace(/[^A-Z.\-]/g, "");
  if (!safe) return null;
  if (safe.length > 8) return null;
  return safe;
}

function computeChangePct(price: number, baseline: number): { change: number; pct: number } {
  const change = price - baseline;
  const pct = (change / baseline) * 100;
  return { change, pct };
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Polygon API key not configured" }, { status: 500 });

  const symbol = cleanTicker(req.nextUrl.searchParams.get("symbol"));
  if (!symbol) return NextResponse.json({ error: "symbol_required" }, { status: 400 });

  try {
    const snapRes = await fetch(`${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apiKey=${apiKey}`, { cache: "no-store" });
    if (!snapRes.ok) {
      const body = await snapRes.text();
      return NextResponse.json({ error: "polygon_error", status: snapRes.status, body }, { status: 502 });
    }
    const snap = await snapRes.json();
    const t = snap?.ticker;

    const last = t?.lastTrade?.p;
    const prevClose = t?.prevDay?.c;
    if (!last || !prevClose || prevClose <= 0) {
      return NextResponse.json({ error: "no_snapshot" }, { status: 404 });
    }

    const { change, pct } = computeChangePct(last, prevClose);

    const out: PolygonTickerSnapshot = {
      ticker: symbol,
      todaysChange: change,
      todaysChangePerc: pct,
      updated: t?.updated ?? Date.now(),
      day: {
        o: t?.day?.o || 0,
        h: typeof t?.day?.h === "number" ? t.day.h : last,
        l: typeof t?.day?.l === "number" ? t.day.l : last,
        c: last,
        v: t?.day?.v || t?.min?.v || 0,
        vw: t?.day?.vw || 0,
      },
      prevDay: t?.prevDay,
      marketCap: null,
      companyName: null,
    };

    // Enrich with reference metadata (cap + name)
    try {
      const refRes = await fetch(`${POLYGON_BASE}/v3/reference/tickers/${symbol}?apiKey=${apiKey}`, { cache: "no-store" });
      if (refRes.ok) {
        const ref = await refRes.json();
        const cap = ref?.results?.market_cap;
        const name = ref?.results?.name;
        out.marketCap = typeof cap === "number" && cap > 0 ? cap : null;
        out.companyName = typeof name === "string" && name.trim() ? name.trim() : null;
      }
    } catch {
      // best-effort
    }

    return NextResponse.json({ ticker: out, fetchedAt: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

