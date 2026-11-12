// #437: a Gainers Table row's press releases. Clicking (or tapping) a row opens a panel under it with
// that stock's releases from the last 30 days, newest first: time, wire and the headline as a link.
// Only DilutionTracker's releases, as the lookup program already saves them once a day per ticker
// (#387, public.chat_gainers_news, read through public.chat_gainers_news_for). Nothing here reads
// another news source. The route is /api/chat/gainers/news?ticker=SYM.

import { alertNewsTime } from "@/lib/chatGainersAlertNews";

/** How far back a row's panel goes. */
export const ROW_NEWS_DAYS = 30;
/** The most releases one panel lists (the lookup saves at most 50 per read). */
export const ROW_NEWS_MAX = 50;
export const ROW_NEWS_EMPTY = "No press releases in the last 30 days.";
const DAY_MS = 86_400_000;
const TICKER = /^[A-Z][A-Z. ]{0,11}$/;

/** One release as the panel shows it. */
export type GainersRowNewsItem = { key: string; title: string; url: string; source: string; publishedAt: string };
export type GainersRowNewsData = { ticker: string; items: GainersRowNewsItem[] };

/** The ticker asked for, or null when it isn't one the table could show. */
export function rowNewsTicker(value: string | null | undefined) {
  const ticker = typeof value === "string" ? value.trim().toUpperCase() : "";
  return TICKER.test(ticker) ? ticker : null;
}

/** When the panel starts: 30 days before now. */
export function rowNewsSince(now = Date.now()) {
  return new Date(now - ROW_NEWS_DAYS * DAY_MS).toISOString();
}

const httpUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * The saved rows (chat_gainers_news_for) for one ticker, as the panel lists them: that ticker only,
 * the last 30 days, a link that is http(s), newest first, each release once, at most ROW_NEWS_MAX.
 */
export function rowNewsItems(rows: unknown, ticker: string, now = Date.now()): GainersRowNewsItem[] {
  if (!Array.isArray(rows)) return [];
  const since = now - ROW_NEWS_DAYS * DAY_MS;
  const seen = new Set<string>();
  const items: GainersRowNewsItem[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.ticker !== ticker) continue;
    const title = typeof row.title === "string" ? row.title.replace(/\s+/g, " ").trim() : "";
    const url = httpUrl(row.url);
    const at = typeof row.published_at === "string" ? Date.parse(row.published_at) : NaN;
    if (!title || !url || !Number.isFinite(at) || at < since) continue;
    const key = typeof row.item_key === "string" && row.item_key ? row.item_key : url;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      key,
      title,
      url,
      source: typeof row.source === "string" ? row.source.trim() : "",
      publishedAt: new Date(at).toISOString(),
    });
  }
  items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.key.localeCompare(b.key));
  return items.slice(0, ROW_NEWS_MAX);
}

/** A release's time in the panel: "7:02 AM ET" today (Eastern), otherwise "Nov 9, 7:02 AM ET". */
export function rowNewsTime(publishedAt: string, now = Date.now()) {
  return alertNewsTime(publishedAt, new Date(now).toISOString());
}

/** What the route answered, checked on the way into the page. */
export function parseRowNewsData(value: unknown, ticker: string): GainersRowNewsItem[] | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { ticker?: unknown; items?: unknown };
  if (body.ticker !== ticker || !Array.isArray(body.items)) return null;
  const items: GainersRowNewsItem[] = [];
  for (const raw of body.items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const url = httpUrl(item.url);
    if (typeof item.title !== "string" || !item.title || !url || typeof item.publishedAt !== "string") continue;
    if (!Number.isFinite(Date.parse(item.publishedAt))) continue;
    items.push({
      key: typeof item.key === "string" ? item.key : url,
      title: item.title,
      url,
      source: typeof item.source === "string" ? item.source : "",
      publishedAt: item.publishedAt,
    });
  }
  return items;
}
