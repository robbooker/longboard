import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";
import { polygonFetch } from "@/lib/polygon-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SnapshotTicker = {
  ticker: string;
  lastTrade?: { p?: number };
  prevDay?: { c?: number };
  day?: { c?: number };
};

type SnapshotResponse = { tickers?: SnapshotTicker[] };

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function todayInET(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** Batch last-price refresh for a set of tickers. Hits Polygon once for
 *  the whole list, then updates last_price + last_price_updated_at on
 *  each matching ticker_research row for today. Returns the fresh prices
 *  directly so the UI can update optimistically without a re-read. If a
 *  ticker has no cached research row for today the update is a no-op —
 *  we still return the price so the UI can show it alongside a missing-
 *  research state. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { tickers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(body.tickers)) {
    return NextResponse.json({ error: "invalid_tickers" }, { status: 400 });
  }

  const tickers = body.tickers
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z][A-Z0-9.]{0,9}$/.test(t));

  if (tickers.length === 0) {
    return NextResponse.json({ prices: {} });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  try {
    const uniq = Array.from(new Set(tickers));
    const path = `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${encodeURIComponent(uniq.join(","))}`;
    const data = await polygonFetch<SnapshotResponse>(path);

    const now = new Date().toISOString();
    const prices: Record<string, { last: number; at: string }> = {};
    for (const t of data.tickers ?? []) {
      const last = t.lastTrade?.p ?? t.day?.c ?? t.prevDay?.c;
      if (t.ticker && typeof last === "number") {
        prices[t.ticker.toUpperCase()] = { last, at: now };
      }
    }

    const today = todayInET();
    const admin = adminClient();

    // Fire row updates in parallel. Failures are non-fatal — the UI still
    // renders the prices from the API response even if the DB write slips.
    await Promise.allSettled(
      Object.entries(prices).map(([ticker, p]) =>
        admin
          .from("ticker_research")
          .update({ last_price: p.last, last_price_updated_at: p.at })
          .eq("ticker", ticker)
          .eq("as_of_date", today)
      )
    );

    return NextResponse.json({ prices, asOfDate: today });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "refresh_failed", message: msg }, { status: 500 });
  }
}
