// #383 News Feed: how one news article becomes a feed item, and how the gainers' headlines and the
// general market headlines are put together into one list. Kept free of fetching so the route
// (app/api/chat/news/feed) and the tests share exactly these rules. Every text field ends up as
// React text, never as HTML; links are only ever http(s).
//
// #387: three sources now. DilutionTracker's press releases for today's gainers (read once a day by
// the lookup program; every release with its wire's name), Polygon (the gainers' and the market's)
// and FMP (market headlines only). The same story from two sources shows once.

export type NewsOrigin = "dt" | "polygon" | "fmp";

export type NewsItem = {
  id: string;
  /** ISO time the article was published. */
  publishedAt: string;
  title: string;
  /** The publisher or wire ("ACCESS Newswire", "GlobeNewswire", "Benzinga"), or "" when unknown. */
  source: string;
  url: string;
  tickers: string[];
  /** A short summary, or null. The page clamps it to two lines. */
  description: string | null;
  /** The article names at least one of today's gainers. */
  gainer: boolean;
  /** #387: where it came from. */
  origin?: NewsOrigin;
  /** #387: a gainer's release older than the default window: only shown when that stock is picked. */
  older?: boolean;
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

/** #387: one article as FMP's /stable/news/general-latest or /stable/news/stock-latest returns it. */
export type FmpArticle = {
  symbol?: unknown;
  publishedDate?: unknown;
  publisher?: unknown;
  site?: unknown;
  title?: unknown;
  url?: unknown;
  text?: unknown;
};

/** #387: one saved DilutionTracker release (public.chat_gainers_news_for). */
export type DtNewsRow = {
  ticker?: unknown;
  item_key?: unknown;
  published_at?: unknown;
  source?: unknown;
  title?: unknown;
  url?: unknown;
};

export const MAX_ITEMS = 100;
/** #387: a gainer's releases from the last three days show by default; older ones under its chip. */
export const DT_DEFAULT_DAYS = 3;
export const DT_KEEP_DAYS = 30;
/** #387: the older releases sent per stock, for its chip. */
const OLDER_PER_TICKER = 30;
/** #387: two copies of one story (same headline, same stock) published this close are one story. */
const SAME_STORY_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 400;
const MAX_TICKERS = 12;
const TICKER = /^[A-Z][A-Z0-9.:-]{0,11}$/;

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

// --- #387: publisher names, cleaned the way ShortScout's Market Headlines card does (the site's
// host first, then the name the source gave).
const SOURCE_BY_HOST: Record<string, string> = {
  "accessnewswire.com": "ACCESS Newswire",
  "accesswire.com": "ACCESS Newswire",
  "apnews.com": "Associated Press",
  "barrons.com": "Barron's",
  "bbc.com": "BBC News",
  "benzinga.com": "Benzinga",
  "bloomberg.com": "Bloomberg",
  "businesswire.com": "Business Wire",
  "cnbc.com": "CNBC",
  "finance.yahoo.com": "Yahoo Finance",
  "fool.com": "The Motley Fool",
  "ft.com": "Financial Times",
  "globenewswire.com": "GlobeNewswire",
  "investing.com": "Investing.com",
  "marketwatch.com": "MarketWatch",
  "newsfilecorp.com": "Newsfile",
  "nytimes.com": "The New York Times",
  "prnewswire.com": "PR Newswire",
  "reuters.com": "Reuters",
  "seekingalpha.com": "Seeking Alpha",
  "wsj.com": "The Wall Street Journal",
  "zacks.com": "Zacks",
};
const SOURCE_BY_NAME: Record<string, string> = {
  "globenewswire inc": "GlobeNewswire",
  globenewswire: "GlobeNewswire",
  "accesswire": "ACCESS Newswire",
  "access newswire": "ACCESS Newswire",
  "business wire": "Business Wire",
  "pr newswire": "PR Newswire",
  barrons: "Barron's",
  "the motley fool": "The Motley Fool",
  "motley fool": "The Motley Fool",
  "zacks investment research": "Zacks",
};

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** The name to show for a story's source: from its link's site when known, else the name given, tidied. */
export function sourceName(given: unknown, url: string): string {
  const site = host(url);
  const bySite = SOURCE_BY_HOST[site] ?? SOURCE_BY_HOST[site.split(".").slice(-2).join(".")];
  if (bySite) return bySite;
  const name = clean(given, 80);
  if (name && !/^https?:/i.test(name)) {
    const key = name.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
    return SOURCE_BY_NAME[key] ?? name.replace(/^www\./i, "");
  }
  return site;
}

/** A short stable id from text (FNV-1a), for stories that come without one. */
function shortHash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The UTC instant of a New York wall-clock time (handles EST and EDT). */
export function easternWallToUtc(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
        .formatToParts(new Date(instant))
        .map((p) => [p.type, Number(p.value)]),
    );
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
  };
  return wall - offsetAt(wall - offsetAt(wall));
}

/** FMP's "2026-10-01 16:08:00" is New York time (the wires' own times match it); a time with a zone is read as given. */
export function fmpTime(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return easternWallToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? Date.parse(value) : NaN;
}

const tickerList = (values: unknown[]) =>
  [...new Set(values.filter((t): t is string => typeof t === "string" && TICKER.test(t)))].slice(0, MAX_TICKERS);

/** One Polygon article as a feed item, or null when it lacks an id, a title, a time or a usable link. */
export function newsItem(article: PolygonArticle, gainers: ReadonlySet<string> = new Set()): NewsItem | null {
  if (!article || typeof article !== "object") return null;
  const id = clean(article.id, 200);
  const title = clean(article.title, MAX_TITLE);
  const url = safeUrl(article.article_url);
  const time = typeof article.published_utc === "string" ? Date.parse(article.published_utc) : NaN;
  if (!id || !title || !url || Number.isNaN(time)) return null;
  const tickers = Array.isArray(article.tickers) ? tickerList(article.tickers) : [];
  const description = clean(article.description, MAX_DESCRIPTION) || null;
  return {
    id,
    publishedAt: new Date(time).toISOString(),
    title,
    source: sourceName(article.publisher?.name, url),
    url,
    tickers,
    description,
    gainer: tickers.some((t) => gainers.has(t)),
    origin: "polygon",
  };
}

// Law-firm "shareholder alerts" and the like crowd out real market news on FMP's general feeds.
const LOW_VALUE_TITLE = /\b(shareholder alert|class action|significant losses|contact the firm|investor deadline|voting rights|total number of shares|allegedly overstated)\b/i;

/** #387: one FMP market article as a feed item (never a gainer item: FMP is the market part only). */
export function fmpItem(article: FmpArticle): NewsItem | null {
  if (!article || typeof article !== "object") return null;
  const title = clean(article.title, MAX_TITLE);
  const url = safeUrl(article.url);
  const time = fmpTime(article.publishedDate);
  if (!title || !url || Number.isNaN(time) || LOW_VALUE_TITLE.test(title)) return null;
  const symbols = typeof article.symbol === "string" ? article.symbol.split(/[,\s]+/).filter((s) => s && s !== "None") : [];
  return {
    id: `fmp-${shortHash(url)}`,
    publishedAt: new Date(time).toISOString(),
    title,
    source: sourceName(article.publisher ?? article.site, url),
    url,
    tickers: tickerList(symbols),
    description: null,
    gainer: false,
    origin: "fmp",
  };
}

/** #387: one saved DilutionTracker release as a feed item; `older` past the default window. */
export function dtItem(row: DtNewsRow, now = Date.now()): NewsItem | null {
  if (!row || typeof row !== "object") return null;
  const ticker = typeof row.ticker === "string" && TICKER.test(row.ticker) ? row.ticker : null;
  const key = clean(row.item_key, 300);
  const title = clean(row.title, MAX_TITLE);
  const url = safeUrl(row.url);
  const time = typeof row.published_at === "string" ? Date.parse(row.published_at) : NaN;
  if (!ticker || !key || !title || !url || Number.isNaN(time) || time < now - DT_KEEP_DAYS * DAY_MS) return null;
  return {
    id: `dt-${ticker}-${shortHash(key)}`,
    publishedAt: new Date(time).toISOString(),
    title,
    source: clean(row.source, 80) || sourceName("", url),
    url,
    tickers: [ticker],
    description: null,
    gainer: true,
    origin: "dt",
    ...(time < now - DT_DEFAULT_DAYS * DAY_MS ? { older: true } : {}),
  };
}

const newestFirst = (a: NewsItem, b: NewsItem) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id);

/** "plastic recycling has a new passport smx is the stamp": a headline for comparing. */
export function headlineKey(title: string) {
  return title.toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Whether two items are the same story: same headline, a stock in common (or no stock named), close in time. */
function sameStory(a: NewsItem, b: NewsItem) {
  if (Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) > SAME_STORY_MS) return false;
  if (!a.tickers.length || !b.tickers.length) return true;
  return a.tickers.some((t) => b.tickers.includes(t));
}

export type NewsSources = {
  /** #387: today's gainers' saved DilutionTracker releases (public.chat_gainers_news_for rows). */
  dtRows?: DtNewsRow[];
  gainerArticles?: PolygonArticle[];
  marketArticles?: PolygonArticle[];
  /** #387: FMP's general and stock headlines. */
  fmpArticles?: FmpArticle[];
  gainers: readonly string[];
  now?: number;
  cap?: number;
};

/**
 * The feed: the gainers' headlines first (DilutionTracker's releases and Polygon's), then the
 * market's (Polygon and FMP), each newest first. A story read twice (for two gainers, for a gainer
 * and the market, or from two sources) shows once, as the first source in that order has it (with
 * the other copy's summary and stocks), in the gainers' part when it names a gainer. At most `cap`
 * items in the default view; a gainer's releases older than three days follow, marked `older`.
 */
export function mergeNewsFeed({ dtRows = [], gainerArticles = [], marketArticles = [], fmpArticles = [], gainers, now = Date.now(), cap = MAX_ITEMS }: NewsSources): NewsItem[] {
  const wanted = new Set(gainers);
  const candidates = [
    ...dtRows.map((row) => dtItem(row, now)).filter((row) => row && wanted.has(row.tickers[0])),
    ...[...gainerArticles, ...marketArticles].map((article) => newsItem(article, wanted)),
    ...fmpArticles.map(fmpItem),
  ].filter((item): item is NewsItem => !!item);
  const byId = new Set<string>();
  const byHeadline = new Map<string, NewsItem[]>();
  const kept: NewsItem[] = [];
  for (const item of candidates) {
    if (byId.has(item.id)) continue;
    byId.add(item.id);
    const key = headlineKey(item.title);
    const twins = byHeadline.get(key) ?? [];
    const twin = twins.find((other) => sameStory(other, item));
    if (twin) {
      twin.description ??= item.description;
      for (const t of item.tickers) if (!twin.tickers.includes(t) && twin.tickers.length < MAX_TICKERS) twin.tickers.push(t);
      twin.gainer ||= item.tickers.some((t) => wanted.has(t));
      continue;
    }
    twins.push(item);
    byHeadline.set(key, twins);
    kept.push(item);
  }
  const recent = kept.filter((i) => !i.older);
  const shown = [...recent.filter((i) => i.gainer).sort(newestFirst), ...recent.filter((i) => !i.gainer).sort(newestFirst)].slice(0, cap);
  const perTicker = new Map<string, number>();
  const older = kept
    .filter((i) => i.older)
    .sort(newestFirst)
    .filter((i) => {
      const n = (perTicker.get(i.tickers[0]) ?? 0) + 1;
      perTicker.set(i.tickers[0], n);
      return n <= OLDER_PER_TICKER;
    });
  return [...shown, ...older];
}

/** The #383 shape: Polygon only. */
export function buildNewsFeed(gainerArticles: PolygonArticle[], marketArticles: PolygonArticle[], gainers: readonly string[], cap = MAX_ITEMS): NewsItem[] {
  return mergeNewsFeed({ gainerArticles, marketArticles, gainers, cap });
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

/** The ids in `next` that aren't in `current`: the "N new" count. Older releases never count. */
export function newItemIds(current: readonly NewsItem[], next: readonly NewsItem[]): string[] {
  const seen = new Set(current.map((i) => i.id));
  return next.filter((i) => !i.older && !seen.has(i.id)).map((i) => i.id);
}

export type NewsFilter = "all" | "gainers" | { ticker: string };

/** All and Gainers only show the last three days; one stock's chip shows all its releases kept. */
export function filterNews(items: readonly NewsItem[], filter: NewsFilter): NewsItem[] {
  if (filter === "all") return items.filter((i) => !i.older);
  if (filter === "gainers") return items.filter((i) => i.gainer && !i.older);
  return items.filter((i) => i.tickers.includes(filter.ticker)).sort(newestFirst);
}
