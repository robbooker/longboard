import { NextResponse } from "next/server";

type NewsItem = {
  id: string;
  ticker: string;
  published_utc?: string;
  title: string;
  author?: string;
  source?: string;
  url?: string;
};

const POLYGON_BASE = "https://api.polygon.io";

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function sanitizeTicker(t: string): string | null {
  const s = t.trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z]{1,5}$/.test(s)) return null;
  return s;
}

export async function GET(req: Request) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Polygon API key not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const tickersParam = searchParams.get("tickers") ?? "";
  const limitParam = Number(searchParams.get("limit") ?? "16");

  const tickers = uniq(
    tickersParam
      .split(",")
      .map((t) => sanitizeTicker(t))
      .filter((t): t is string => Boolean(t))
  ).slice(0, 12);

  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, limitParam)) : 16;

  if (tickers.length === 0) {
    return NextResponse.json({ items: [] satisfies NewsItem[] }, { status: 200 });
  }

  // Fetch in parallel, but keep it bounded (max 12 tickers).
  const perTicker = await Promise.all(
    tickers.map(async (ticker) => {
      const url = new URL(`${POLYGON_BASE}/v2/reference/news`);
      url.searchParams.set("ticker", ticker);
      url.searchParams.set("limit", "6");
      url.searchParams.set("apiKey", apiKey);

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) return [] as NewsItem[];
      const data = await res.json().catch(() => ({}));
      const results = Array.isArray(data?.results) ? data.results : [];

      return results
        .map((r: any) => {
          const id = String(r?.id ?? `${ticker}:${r?.published_utc ?? ""}:${r?.title ?? ""}`);
          const title = String(r?.title ?? "").trim();
          if (!title) return null;
          return {
            id,
            ticker,
            published_utc: typeof r?.published_utc === "string" ? r.published_utc : undefined,
            title,
            author: typeof r?.author === "string" ? r.author : undefined,
            source: typeof r?.publisher?.name === "string" ? r.publisher.name : undefined,
            url: typeof r?.article_url === "string" ? r.article_url : undefined,
          } satisfies NewsItem;
        })
        .filter(Boolean) as NewsItem[];
    })
  );

  // Interleave by recency to keep it "tape-like".
  const flat = perTicker.flat();
  flat.sort((a, b) => {
    const ta = a.published_utc ? Date.parse(a.published_utc) : 0;
    const tb = b.published_utc ? Date.parse(b.published_utc) : 0;
    return tb - ta;
  });

  const items = flat.slice(0, limit);
  return NextResponse.json({ items }, { status: 200 });
}

