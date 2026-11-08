// #387: one read of a ticker's DilutionTracker News tab, as the lookup program posts it to
// /api/chat/gainers/facts (kind "news"), checked on the way in; and which of today's tickers still
// need their once-a-day read. Pure; the route does the saving (public.save_chat_gainers_news).

/** The most releases one read may carry (the lookup sends at most 50, the last 30 days). */
export const NEWS_POST_MAX = 60;
const TICKER = /^[A-Z][A-Z. ]{0,11}$/;
const KEYS = ["kind", "ticker", "items"];
const ITEM_KEYS = ["publishedAt", "source", "title", "url", "dtItemId"];
const DAY_MS = 86_400_000;

export type GainersNewsItemInput = { key: string; published_at: string; source: string; title: string; url: string };
export type GainersNewsInput = { ticker: string; items: GainersNewsItemInput[] };

const text = (value: unknown, max: number) =>
  typeof value === "string" && !value.includes("\0") ? value.replace(/\s+/g, " ").trim().slice(0, max) : null;

function httpUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Checks one news read; returns only the known fields, or null when anything is off. */
export function parseGainersNews(value: unknown, now = Date.now()): GainersNewsInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (p.kind !== "news" || Object.keys(p).some((key) => !KEYS.includes(key))) return null;
  if (typeof p.ticker !== "string" || !TICKER.test(p.ticker)) return null;
  if (!Array.isArray(p.items) || p.items.length > NEWS_POST_MAX) return null;
  const items: GainersNewsItemInput[] = [];
  const seen = new Set<string>();
  for (const raw of p.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => !ITEM_KEYS.includes(key))) return null;
    const title = text(item.title, 300);
    const source = item.source === undefined || item.source === null ? "" : text(item.source, 80);
    const url = httpUrl(item.url);
    const time = typeof item.publishedAt === "string" ? Date.parse(item.publishedAt) : NaN;
    const id = item.dtItemId === undefined || item.dtItemId === null ? null : item.dtItemId;
    if (!title || source === null || !url || !Number.isFinite(time)) return null;
    if (time > now + DAY_MS || time < now - 400 * DAY_MS) return null;
    if (id !== null && (typeof id !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(id))) return null;
    const key = id ? `dt:${id}` : url.slice(0, 300);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, published_at: new Date(time).toISOString(), source, title, url });
  }
  return { ticker: p.ticker, items };
}

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * The tickers whose News tab was read that day, or null when that can't be told (the migration
 * isn't applied yet, or the database failed): then no news reads are asked for.
 */
export async function newsCheckedForDay(db: RpcClient, day: string): Promise<Set<string> | null> {
  try {
    const { data, error } = await db.rpc("chat_gainers_news_checked", { p_day: day });
    if (error || !Array.isArray(data)) return null;
    return new Set((data as { ticker?: unknown }[]).map((row) => row?.ticker).filter((t): t is string => typeof t === "string"));
  } catch {
    return null;
  }
}

/** Today's tickers whose News tab hasn't been read yet today, in the table's order. */
export function newsNeeded(tickers: readonly string[], checked: ReadonlySet<string>) {
  return tickers.filter((ticker) => !checked.has(ticker)).map((ticker) => ({ ticker }));
}
