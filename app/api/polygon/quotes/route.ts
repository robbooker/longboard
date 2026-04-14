import { NextRequest, NextResponse } from "next/server";
import { polygonFetch } from "@/lib/polygon-api";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SnapshotTicker = {
  ticker: string;
  lastTrade?: { p?: number };
  prevDay?: { c?: number };
  day?: { c?: number };
};

type SnapshotResponse = {
  tickers?: SnapshotTicker[];
};

/** Batch last-price lookup for a comma-separated list of tickers.
 *  Used by /tradezero positions table to show live Last / P&L / P&L %.
 *  Returns { quotes: { SYMBOL: { last: number } } } with one entry per
 *  ticker Polygon responded for. Missing tickers simply don't appear —
 *  callers render "—" for them. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z][A-Z0-9.]{0,9}$/.test(s));

  if (symbols.length === 0) {
    return NextResponse.json({ quotes: {} });
  }

  try {
    const path = `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${encodeURIComponent(symbols.join(","))}`;
    const data = await polygonFetch<SnapshotResponse>(path);
    const quotes: Record<string, { last: number }> = {};
    for (const t of data.tickers ?? []) {
      const last = t.lastTrade?.p ?? t.day?.c ?? t.prevDay?.c;
      if (t.ticker && typeof last === "number") {
        quotes[t.ticker.toUpperCase()] = { last };
      }
    }
    return NextResponse.json({ quotes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Polygon quotes error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
