import { NextResponse, type NextRequest } from "next/server";
import type { PolygonTickerSnapshot } from "@/types/polygon";

const POLYGON_BASE = "https://api.polygon.io";

const SMALL_CAP_MIN = 20_000_000; // $20M
const SMALL_CAP_MAX = 2_000_000_000; // $2B

const CANDIDATE_POOL = 60;
const FINAL_LIST_SIZE = 12;

type Kind = "gainers" | "losers" | "active" | "unusual";
type Session = "auto" | "market" | "pre" | "post";

function etNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function isPreMarket(et: Date): boolean {
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins < 570; // 9:30 AM
}

function isAfterHours(et: Date): boolean {
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 960; // 4:00 PM
}

function isWeekend(et: Date): boolean {
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

async function filterToSmallCap(candidates: PolygonTickerSnapshot[], apiKey: string): Promise<PolygonTickerSnapshot[]> {
  async function fetchMeta(ticker: string): Promise<{ marketCap: number | null; companyName: string | null }> {
    const url = `${POLYGON_BASE}/v3/reference/tickers/${ticker}?apiKey=${apiKey}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.status === 429 && attempt === 0) {
          // Back off briefly and retry once.
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        if (!res.ok) return { marketCap: null, companyName: null };
        const data = await res.json().catch(() => ({}));
        const cap = (data as any)?.results?.market_cap;
        const name = (data as any)?.results?.name;
        return {
          marketCap: typeof cap === "number" && cap > 0 ? cap : null,
          companyName: typeof name === "string" && name.trim() ? name.trim() : null,
        };
      } catch {
        // try again (once)
      }
    }
    return { marketCap: null, companyName: null };
  }

  // Avoid burst rate-limiting: resolve in small batches.
  const metas: Array<{ marketCap: number | null; companyName: string | null }> = [];
  const batchSize = 8;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const batchMetas = await Promise.all(batch.map((c) => fetchMeta(c.ticker)));
    metas.push(...batchMetas);
  }

  const withMeta: PolygonTickerSnapshot[] = candidates.map((c, i) => ({
    ...c,
    marketCap: metas[i]?.marketCap ?? null,
    companyName: metas[i]?.companyName ?? null,
  }));

  return withMeta.filter((c) => c.marketCap != null && c.marketCap >= SMALL_CAP_MIN && c.marketCap <= SMALL_CAP_MAX);
}

async function fetchAllSnapshots(apiKey: string) {
  const res = await fetch(`${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers?apiKey=${apiKey}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polygon returned ${res.status}: ${body}`);
  }
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.tickers || []) as any[];
}

function computeChangePct(price: number, baseline: number): { change: number; pct: number } {
  const change = price - baseline;
  const pct = (change / baseline) * 100;
  return { change, pct };
}

function toSnapshot(t: any, change: number, changePct: number, price: number): PolygonTickerSnapshot {
  return {
    ticker: t.ticker,
    todaysChange: change,
    todaysChangePerc: changePct,
    updated: t.updated,
    day: {
      o: t.day?.o || 0,
      h: typeof t.day?.h === "number" ? t.day.h : price,
      l: typeof t.day?.l === "number" ? t.day.l : price,
      c: price,
      v: t.day?.v || t.min?.v || 0,
      vw: t.day?.vw || 0,
    },
    prevDay: t.prevDay,
  } as PolygonTickerSnapshot;
}

async function moversFromSnapshots(params: {
  apiKey: string;
  kind: Kind;
  baseline: "prev_close" | "regular_close";
  minVol: number;
  minMovePctForGainersLosers: number;
}): Promise<PolygonTickerSnapshot[]> {
  const all = await fetchAllSnapshots(params.apiKey);
  const rows: PolygonTickerSnapshot[] = [];

  for (const t of all) {
    const ticker = t?.ticker;
    if (!filterTicker(ticker)) continue;

    const price = t?.lastTrade?.p;
    const baseline = params.baseline === "regular_close" ? t?.day?.c : t?.prevDay?.c;
    if (!price || !baseline || baseline <= 0) continue;
    if (price < 1) continue;

    const vol = t?.day?.v ?? t?.min?.v ?? 0;
    if (params.minVol > 0) {
      if (!vol || vol < params.minVol) continue;
    }

    const { change, pct } = computeChangePct(price, baseline);

    if (params.kind === "gainers") {
      if (pct <= params.minMovePctForGainersLosers) continue;
      rows.push(toSnapshot(t, change, pct, price));
      continue;
    }

    if (params.kind === "losers") {
      if (pct >= -params.minMovePctForGainersLosers) continue;
      rows.push(toSnapshot(t, change, pct, price));
      continue;
    }

    if (params.kind === "active") {
      // We'll sort by volume later; keep a smaller eligibility gate
      rows.push(toSnapshot(t, change, pct, price));
      continue;
    }

    if (params.kind === "unusual") {
      // MVP unusual: dollar-volume ranking with a modest move threshold
      if (Math.abs(pct) < 2.5) continue;
      rows.push(toSnapshot(t, change, pct, price));
      continue;
    }
  }

  if (params.kind === "active") {
    rows.sort((a, b) => (b.day?.v ?? 0) - (a.day?.v ?? 0));
  } else if (params.kind === "unusual") {
    rows.sort((a, b) => (b.day?.c ?? 0) * (b.day?.v ?? 0) - (a.day?.c ?? 0) * (a.day?.v ?? 0));
  } else if (params.kind === "losers") {
    rows.sort((a, b) => a.todaysChangePerc - b.todaysChangePerc);
  } else {
    rows.sort((a, b) => b.todaysChangePerc - a.todaysChangePerc);
  }

  return rows.slice(0, CANDIDATE_POOL);
}

async function moversFromMarketEndpoint(apiKey: string, kind: "gainers" | "losers"): Promise<PolygonTickerSnapshot[]> {
  const res = await fetch(`${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/${kind}?apiKey=${apiKey}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polygon returned ${res.status}: ${body}`);
  }
  const data = await res.json();
  const candidates: PolygonTickerSnapshot[] = (data.tickers || [])
    .filter((t: PolygonTickerSnapshot) => filterTicker(t.ticker) && t.day?.c >= 1)
    .slice(0, CANDIDATE_POOL);

  return candidates;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Polygon API key not configured" }, { status: 500 });

  const kindRaw = (request.nextUrl.searchParams.get("kind") || "gainers").toLowerCase();
  const kind: Kind = (["gainers", "losers", "active", "unusual"] as const).includes(kindRaw as Kind)
    ? (kindRaw as Kind)
    : "gainers";

  const sessionRaw = (request.nextUrl.searchParams.get("session") || "auto").toLowerCase();
  const session: Session = (["auto", "market", "pre", "post"] as const).includes(sessionRaw as Session)
    ? (sessionRaw as Session)
    : "auto";

  const et = etNow();
  const autoMode = isWeekend(et) || isPreMarket(et) ? "pre-market" : isAfterHours(et) ? "post-market" : "market";
  const mode =
    session === "pre"
      ? "pre-market"
      : session === "post"
        ? "post-market"
        : session === "market"
          ? "market"
          : autoMode;

  try {
    let candidates: PolygonTickerSnapshot[] = [];
    const isPremarket = mode === "pre-market";
    // Pre-market bulk snapshot often has 0 day/min volume; don't gate on vol.
    const minVol = isPremarket ? 0 : 1000;
    const minMovePctForGainersLosers = isPremarket ? 0.75 : 5;

    if (kind === "gainers" || kind === "losers") {
      // During regular market hours, Polygon's dedicated endpoint is fast.
      // Outside market hours, compute from the full snapshot universe so we can
      // still surface small-cap movers (and not just mega-caps).
      if (mode === "market") {
        try {
          candidates = await moversFromMarketEndpoint(apiKey, kind);
        } catch {
          candidates = [];
        }
      }
      if (candidates.length === 0) {
        candidates = await moversFromSnapshots({
          apiKey,
          kind,
          baseline: mode === "post-market" ? "regular_close" : "prev_close",
          minVol,
          minMovePctForGainersLosers,
        });
      }
    } else {
      candidates = await moversFromSnapshots({
        apiKey,
        kind,
        baseline: mode === "post-market" ? "regular_close" : "prev_close",
        minVol,
        minMovePctForGainersLosers,
      });
    }

    const smallCaps = await filterToSmallCap(candidates, apiKey);
    const out = smallCaps.slice(0, FINAL_LIST_SIZE);

    return NextResponse.json({
      kind,
      mode,
      fetchedAt: new Date().toISOString(),
      tickers: out,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

