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
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const SOURCE_TIMEOUT_MS = 8_000;
const POLYGON_PER_TICKER_LIMIT = 6;
const EXA_PER_TICKER_LIMIT = 4;
const EXA_LOOKBACK_DAYS = 7;

type ExaResult = {
  title?: string;
  url?: string;
  publishedDate?: string;
};

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function sanitizeTicker(t: string): string | null {
  const s = t.trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z]{1,5}$/.test(s)) return null;
  return s;
}

function sourceFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || undefined;
  } catch {
    return undefined;
  }
}

function normalizeKey(item: NewsItem): string {
  return (item.url || `${item.ticker}:${item.title}`).trim().toLowerCase();
}

function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    const key = normalizeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SOURCE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPolygonNews(ticker: string, apiKey: string): Promise<NewsItem[]> {
  const url = new URL(`${POLYGON_BASE}/v2/reference/news`);
  url.searchParams.set("ticker", ticker);
  url.searchParams.set("limit", String(POLYGON_PER_TICKER_LIMIT));
  url.searchParams.set("apiKey", apiKey);

  try {
    const res = await fetchWithTimeout(url.toString(), {});
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data?.results) ? data.results : [];

    return results
      .map((r: any) => {
        const id = String(r?.id ?? `${ticker}:polygon:${r?.published_utc ?? ""}:${r?.title ?? ""}`);
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
  } catch {
    return [];
  }
}

async function fetchWebNews(ticker: string, apiKey: string | undefined): Promise<NewsItem[]> {
  if (!apiKey) return [];

  const since = new Date(Date.now() - EXA_LOOKBACK_DAYS * 86_400_000).toISOString();
  try {
    const res = await fetchWithTimeout(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `${ticker} stock news press release catalyst today`,
        numResults: EXA_PER_TICKER_LIMIT,
        startPublishedDate: since,
        contents: { text: { maxCharacters: 200 } },
        useAutoprompt: false,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as { results?: ExaResult[] };

    return (data.results ?? [])
      .map((r, index) => {
        const title = String(r.title ?? "").trim();
        if (!title) return null;
        const url = typeof r.url === "string" ? r.url : undefined;
        return {
          id: `${ticker}:web:${url ?? `${r.publishedDate ?? ""}:${index}`}`,
          ticker,
          published_utc: typeof r.publishedDate === "string" ? r.publishedDate : undefined,
          title,
          source: sourceFromUrl(url) ?? "Web",
          url,
        } satisfies NewsItem;
      })
      .filter(Boolean) as NewsItem[];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const apiKey = process.env.POLYGON_API_KEY;
  const exaKey = process.env.EXA_API_KEY;
  if (!apiKey && !exaKey) {
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
      const [polygonItems, webItems] = await Promise.all([
        apiKey ? fetchPolygonNews(ticker, apiKey) : Promise.resolve([]),
        fetchWebNews(ticker, exaKey),
      ]);
      return dedupeNews([...polygonItems, ...webItems]);
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
