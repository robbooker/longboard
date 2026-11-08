// #383 News Feed: how one Polygon news article becomes a feed item, and how the gainers' headlines
// and the general market headlines are put together into one list. Kept free of fetching so the
// route (app/api/chat/news/feed) and the tests share exactly these rules. Every text field ends up
// as React text, never as HTML; links are only ever http(s).

export type NewsItem = {
  id: string;
  /** ISO time the article was published. */
  publishedAt: string;
  title: string;
  /** The publisher's name ("Benzinga", "GlobeNewswire Inc."), or "" when Polygon didn't say. */
  source: string;
  url: string;
  tickers: string[];
  /** A short summary, or null. The page clamps it to two lines. */
  description: string | null;
  /** The article names at least one of today's gainers. */
  gainer: boolean;
};

export type NewsFeedData = {
  /** Today's gainers whose news was read, newest alert first (the chip row). */
  gainers: string[];
  items: NewsItem[];
  /** Some reads failed or timed out; the list is what came back. */
  partial: boolean;
};

/** One article as Polygon's /v2/reference/news returns it (only the fields used). */
export type PolygonArticle = {
  id?: unknown;
  title?: unknown;
  article_url?: unknown;
  description?: unknown;
  published_utc?: unknown;
  tickers?: unknown;
  publisher?: { name?: unknown } | null;
};

export const MAX_ITEMS = 100;
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 400;
const MAX_TICKERS = 12;

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** One article as a feed item, or null when it lacks an id, a title, a time or a usable link. */
export function newsItem(article: PolygonArticle, gainers: ReadonlySet<string> = new Set()): NewsItem | null {
  if (!article || typeof article !== "object") return null;
  const id = clean(article.id, 200);
  const title = clean(article.title, MAX_TITLE);
  const url = safeUrl(article.article_url);
  const time = typeof article.published_utc === "string" ? Date.parse(article.published_utc) : NaN;
  if (!id || !title || !url || Number.isNaN(time)) return null;
  const tickers = Array.isArray(article.tickers)
    ? [...new Set(article.tickers.filter((t): t is string => typeof t === "string" && /^[A-Z][A-Z0-9.:-]{0,11}$/.test(t)))].slice(0, MAX_TICKERS)
    : [];
  const description = clean(article.description, MAX_DESCRIPTION) || null;
  return {
    id,
    publishedAt: new Date(time).toISOString(),
    title,
    source: clean(article.publisher?.name, 80),
    url,
    tickers,
    description,
    gainer: tickers.some((t) => gainers.has(t)),
  };
}

const newestFirst = (a: NewsItem, b: NewsItem) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id);

/**
 * The feed: the gainers' headlines first, then the general market headlines, each newest first.
 * An article read twice (for two gainers, or for a gainer and the market) shows once, in the
 * gainers' part when it names a gainer. At most `cap` items.
 */
export function buildNewsFeed(gainerArticles: PolygonArticle[], marketArticles: PolygonArticle[], gainers: readonly string[], cap = MAX_ITEMS): NewsItem[] {
  const wanted = new Set(gainers);
  const byId = new Map<string, NewsItem>();
  for (const article of [...gainerArticles, ...marketArticles]) {
    const item = newsItem(article, wanted);
    if (item && !byId.has(item.id)) byId.set(item.id, item);
  }
  const items = [...byId.values()];
  return [...items.filter((i) => i.gainer).sort(newestFirst), ...items.filter((i) => !i.gainer).sort(newestFirst)].slice(0, cap);
}

/** "now", "4m", "3h", "2d": how long ago, for the list. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/** The ids in `next` that aren't in `current`: the "N new" count. */
export function newItemIds(current: readonly NewsItem[], next: readonly NewsItem[]): string[] {
  const seen = new Set(current.map((i) => i.id));
  return next.filter((i) => !seen.has(i.id)).map((i) => i.id);
}

export type NewsFilter = "all" | "gainers" | { ticker: string };

export function filterNews(items: readonly NewsItem[], filter: NewsFilter): NewsItem[] {
  if (filter === "all") return [...items];
  if (filter === "gainers") return items.filter((i) => i.gainer);
  return items.filter((i) => i.tickers.includes(filter.ticker));
}
