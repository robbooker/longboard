import { fmpTime, type FmpArticle } from "@/lib/chatNews";

// #387 News Feed: FMP's market headlines, beside Polygon's, the way ShortScout's Market Headlines
// card mixes them: /stable/news/general-latest (the wider news: economy, policy, world) and
// /stable/news/stock-latest (single-stock stories). The key goes in the apikey header, never the
// address. Both reads are cached for FMP_TTL_MS for every viewer on this server instance, share one
// request while in flight and give up after FMP_TIMEOUT_MS; a failed read is remembered for a
// shorter while. Without FMP_API_KEY nothing is read and the feed is Polygon's alone.

export const FMP_TTL_MS = 60_000;
const FAILED_TTL_MS = 15_000;
export const FMP_TIMEOUT_MS = 5_000;
const FMP_LIMIT = 50;
/** Market headlines older than a day are left out, like Polygon's market part. */
const LOOKBACK_MS = 86_400_000;
const FEEDS = ["general-latest", "stock-latest"] as const;

type Read = { ok: boolean; articles: FmpArticle[] };
type Entry = { at: number; read: Read };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<Read>>();

async function readFeed(path: (typeof FEEDS)[number], key: string): Promise<Read> {
  const url = new URL(`https://financialmodelingprep.com/stable/news/${path}`);
  url.searchParams.set("page", "0");
  url.searchParams.set("limit", String(FMP_LIMIT));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FMP_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { headers: { apikey: key }, cache: "no-store", signal: controller.signal });
    if (!response.ok) return { ok: false, articles: [] };
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? { ok: true, articles: body as FmpArticle[] } : { ok: false, articles: [] };
  } catch {
    return { ok: false, articles: [] };
  } finally {
    clearTimeout(timer);
  }
}

function cachedFeed(path: (typeof FEEDS)[number], key: string, now: number): Promise<Read> {
  const hit = cache.get(path);
  if (hit && now - hit.at < (hit.read.ok ? FMP_TTL_MS : FAILED_TTL_MS)) return Promise.resolve(hit.read);
  const inFlight = pending.get(path);
  if (inFlight) return inFlight;
  const read = readFeed(path, key)
    .then((result) => {
      cache.set(path, { at: Date.now(), read: result });
      return result;
    })
    .finally(() => pending.delete(path));
  pending.set(path, read);
  return read;
}

/**
 * FMP's general and stock headlines from the last day. `configured` is false without a key (then
 * nothing was read and nothing counts as failed); `ok` and `reads` say how many of the two worked.
 */
export async function readFmpNews(now = Date.now()) {
  const key = process.env.FMP_API_KEY;
  if (!key) return { configured: false, okReads: 0, reads: 0, articles: [] as FmpArticle[] };
  const results = await Promise.all(FEEDS.map((path) => cachedFeed(path, key, now)));
  const since = now - LOOKBACK_MS;
  const articles = results.flatMap((r) => r.articles).filter((a) => fmpTime(a?.publishedDate) >= since);
  return { configured: true, okReads: results.filter((r) => r.ok).length, reads: results.length, articles };
}

/** For tests. */
export function resetFmpCache() {
  cache.clear();
  pending.clear();
}
