import type { PolygonArticle } from "@/lib/chatNews";

// #383 News Feed: reading Polygon's news (GET /v2/reference/news). Polygon filters by one ticker
// per request (no list filter), so the feed reads the top NEWS_TICKERS gainers in parallel, plus
// one general market read. Every read is cached for NEWS_TTL_MS for all viewers on this server
// instance (the feed polls every minute), shares one request while it is in flight, and gives up
// after NEWS_TIMEOUT_MS. A failed read is remembered for a shorter while, so a Polygon outage
// isn't asked again by every viewer at once, and counts as "partial" in the answer.

export const NEWS_TTL_MS = 60_000;
export const FAILED_TTL_MS = 15_000;
export const NEWS_TIMEOUT_MS = 5_000;
/** How many of today's gainers get their own news read (newest alert first). */
export const NEWS_TICKERS = 15;
const PER_TICKER = 6;
const MARKET_LIMIT = 60;
/** A gainer's story from the last three days still matters; the market part is the last day. */
const TICKER_LOOKBACK_MS = 3 * 86_400_000;
const MARKET_LOOKBACK_MS = 86_400_000;

type Read = { ok: boolean; articles: PolygonArticle[] };
type Entry = { at: number; read: Read };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<Read>>();

async function readNews(ticker: string | null, now: number): Promise<Read> {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return { ok: false, articles: [] };
  const url = new URL("https://api.polygon.io/v2/reference/news");
  if (ticker) url.searchParams.set("ticker", ticker);
  url.searchParams.set("order", "desc");
  url.searchParams.set("sort", "published_utc");
  url.searchParams.set("limit", String(ticker ? PER_TICKER : MARKET_LIMIT));
  url.searchParams.set("published_utc.gte", new Date(now - (ticker ? TICKER_LOOKBACK_MS : MARKET_LOOKBACK_MS)).toISOString());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, articles: [] };
    const body = (await response.json()) as { results?: unknown };
    return { ok: true, articles: Array.isArray(body?.results) ? (body.results as PolygonArticle[]) : [] };
  } catch {
    return { ok: false, articles: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** One read (a ticker's news, or the market's with null), from the cache when fresh. */
export function cachedNews(ticker: string | null, now = Date.now()): Promise<Read> {
  const id = ticker ?? "*market";
  const hit = cache.get(id);
  if (hit && now - hit.at < (hit.read.ok ? NEWS_TTL_MS : FAILED_TTL_MS)) return Promise.resolve(hit.read);
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const read = readNews(ticker, now)
    .then((result) => {
      cache.set(id, { at: Date.now(), read: result });
      return result;
    })
    .finally(() => pending.delete(id));
  pending.set(id, read);
  if (cache.size > 500) for (const [k, e] of cache) if (now - e.at > 10 * 60_000) cache.delete(k);
  return read;
}

/** The gainers' articles and the market's, and whether every read worked. */
export async function readNewsSources(tickers: readonly string[]) {
  const [market, ...perTicker] = await Promise.all([cachedNews(null), ...tickers.map((t) => cachedNews(t))]);
  return {
    gainerArticles: perTicker.flatMap((r) => r.articles),
    marketArticles: market.articles,
    okReads: [market, ...perTicker].filter((r) => r.ok).length,
    reads: perTicker.length + 1,
  };
}

/** For tests. */
export function resetNewsCache() {
  cache.clear();
  pending.clear();
}
