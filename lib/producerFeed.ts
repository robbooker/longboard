// #484 PRODUCER-FEED: the rules behind GET /api/producer/morning, the read-only morning feed for the
// Producer agent in Marketing HQ (it writes Rob's 7:15am CT webinar run sheet, around 7:50am ET).
// Kept free of database and network reads so the route and the tests share exactly these rules.
//
//  * gainers: the Gainers room's alerts from midnight to 9:30am New York that day (premarket),
//    read the way the room's own Gainers Table reads them (chat_gainers_table in
//    20261110230000_chat_gainers_above_prev_close.sql): "🚨 SYM (+NN.N%)" alerts, no after-hours
//    ones, and a stock counts once one of its alerts shows at least 150,000 shares. Ranked by the
//    latest % move the room posted for it.
//  * market_headlines: the general market headlines (Polygon's and FMP's, the two sources
//    ShortScout's Market Headlines card blends), newest first, one per headline.
//  * question: the newest unanswered member question in the ShortScout room since the previous
//    trading day's 4:00pm New York close. First name only.
import { easternWallToUtc, fmpItem, headlineKey, newsItem, type FmpArticle, type NewsItem, type PolygonArticle } from "@/lib/chatNews";
import { isUsMarketHoliday } from "@/lib/marketCalendar";

export const PRODUCER_FEED_TOKEN_ENV = "PRODUCER_FEED_TOKEN";
export const PRODUCER_ROOM = "shortscout";
export const GAINERS_ROOM = "gainers";
export const GAINERS_DEFAULT = 3;
export const GAINERS_MAX = 10;
export const HEADLINES_PER_GAINER = 3;
export const MARKET_HEADLINES_MAX = 10;
/** The room's rule: a stock counts once one of its alerts shows this many shares. */
export const MIN_ALERT_VOLUME = 150_000;
/** "Substantive": at least this many characters once links and extra spaces are gone. */
export const QUESTION_MIN_CHARS = 20;
/** A gainer's DilutionTracker releases from this many days before the day still count. */
export const GAINER_NEWS_DAYS = 30;
const DAY_MS = 86_400_000;

export const MISSING = {
  gainers: "No premarket gainers in the Gainers room yet.",
  gainersError: "Gainers room alerts unavailable (database error).",
  countryError: "Gainer countries unavailable (database error).",
  gainerNewsError: "DilutionTracker headlines unavailable (database error).",
  question: "No ShortScout question since yesterday's close.",
  questionError: "ShortScout question unavailable (database error).",
  headlines: "No market headlines in the last day.",
  headlinesPast: "Market headlines are live only, so there are none for a past date.",
  polygonOff: "Market headlines unavailable (Polygon not configured).",
  polygonError: "Market headlines unavailable (Polygon error).",
  fmpOff: "Market headlines unavailable (FMP not configured).",
  fmpError: "Market headlines unavailable (FMP error).",
} as const;

export type ProducerHeadline = { title: string; published_at: string | null; source: string; url: string | null };
export type ProducerGainer = {
  symbol: string;
  change_pct: number;
  price: number | null;
  first_alert_at: string;
  country: string | null;
  headlines: ProducerHeadline[];
};
export type ProducerMarketHeadline = { title: string; source: string; url: string | null; published_at: string | null };
export type ProducerQuestion = { first_name: string; body: string; posted_at: string };
export type ProducerFeed = {
  date: string;
  generated_at: string;
  gainers: ProducerGainer[];
  market_headlines: ProducerMarketHeadline[];
  question: ProducerQuestion | null;
  missing: string[];
};

// --- Days and times (New York).

/** Today's date in New York, YYYY-MM-DD. */
export function easternToday(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/** ?date=: a real YYYY-MM-DD, or today in New York when absent. Null when given but not a date. */
export function parseFeedDate(value: string | null, now = Date.now()): string | null {
  if (value === null || value === "") return easternToday(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** ?limit=: 1 to 10 gainers, 3 when absent. Null when given but not a whole number in range. */
export function parseGainersLimit(value: string | null): number | null {
  if (value === null || value === "") return GAINERS_DEFAULT;
  if (!/^\d{1,2}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= GAINERS_MAX ? n : null;
}

const dayParts = (day: string) => day.split("-").map(Number) as [number, number, number];

/** The UTC instant of a New York wall-clock time on that day. */
export function easternAt(day: string, hour: number, minute = 0) {
  const [y, m, d] = dayParts(day);
  return easternWallToUtc(y, m, d, hour, minute);
}

function shiftDay(day: string, days: number) {
  const [y, m, d] = dayParts(day);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A weekday that isn't a listed US market holiday. */
export function isTradingDay(day: string) {
  const [y, m, d] = dayParts(day);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isUsMarketHoliday(day);
}

/** The trading day before `day` (weekends and listed holidays skipped). */
export function previousTradingDay(day: string) {
  let prev = shiftDay(day, -1);
  for (let i = 0; i < 10 && !isTradingDay(prev); i++) prev = shiftDay(prev, -1);
  return prev;
}

/** The previous trading day's 4:00pm New York close, as an instant. */
export function previousClose(day: string) {
  return easternAt(previousTradingDay(day), 16);
}

/**
 * The window the feed reads for `day`: from the day's start (gainers) or the previous close
 * (question) up to 9:30am New York that day, or now when that is earlier.
 */
export function feedWindow(day: string, now = Date.now()) {
  const open = easternAt(day, 9, 30);
  return { dayStart: easternAt(day, 0), questionsSince: previousClose(day), until: Math.min(open, now) };
}

// --- Gainers.

export type GainersAlertRow = { id?: string; created_at: string; body: string };
type Parsed = { symbol: string; pct: number; price: number | null; volume: number; at: number; afterHours: boolean };

const number = (text: string | undefined) => (text === undefined ? NaN : Number(text.replace(/,/g, "")));

/** One alert's ticker, % move, price, volume and session, or null when it isn't a "🚨 SYM (+NN%)" alert. */
export function parseGainersAlertBody(row: GainersAlertRow): Parsed | null {
  if (typeof row?.body !== "string") return null;
  const head = row.body.match(/^🚨 ([A-Z. ]+?) \(\+([0-9][0-9,]*(?:\.[0-9]+)?)%\)/);
  const at = Date.parse(row.created_at);
  if (!head || !Number.isFinite(at)) return null;
  const pct = number(head[2]);
  if (!Number.isFinite(pct)) return null;
  const priceText =
    row.body.match(/Extended Price: \$([0-9][0-9,]{0,14}(?:\.[0-9]{1,8})?)/)?.[1] ??
    row.body.match(/Price: \$([0-9][0-9,]{0,14}(?:\.[0-9]{1,8})?)/)?.[1];
  const price = number(priceText);
  const volume = number(row.body.match(/Volume: ([0-9,]{1,20})/)?.[1]);
  return {
    symbol: head[1],
    pct,
    price: Number.isFinite(price) ? price : null,
    volume: Number.isFinite(volume) ? volume : 0,
    at,
    afterHours: /After[- ]Hours/.test(row.body),
  };
}

export type RankedGainer = { symbol: string; change_pct: number; price: number | null; first_alert_at: string };

/**
 * The day's premarket gainers, biggest move first: alerts before `until` only, no after-hours
 * ones, a stock only once one of its alerts showed 150,000 shares, its % move and price from its
 * latest alert, and its first alert's time.
 */
export function rankPremarketGainers(rows: readonly GainersAlertRow[], until: number, limit = GAINERS_DEFAULT): RankedGainer[] {
  const bySymbol = new Map<string, Parsed[]>();
  for (const row of rows) {
    const alert = parseGainersAlertBody(row);
    if (!alert || alert.afterHours || alert.at >= until) continue;
    const list = bySymbol.get(alert.symbol) ?? [];
    list.push(alert);
    bySymbol.set(alert.symbol, list);
  }
  const ranked: RankedGainer[] = [];
  for (const [symbol, alerts] of bySymbol) {
    if (!alerts.some((a) => a.volume >= MIN_ALERT_VOLUME)) continue;
    alerts.sort((a, b) => a.at - b.at);
    const latest = alerts[alerts.length - 1];
    ranked.push({
      symbol,
      change_pct: latest.pct,
      price: latest.price,
      first_alert_at: new Date(alerts[0].at).toISOString(),
    });
  }
  return ranked.sort((a, b) => b.change_pct - a.change_pct || a.symbol.localeCompare(b.symbol)).slice(0, limit);
}

export type GainerNewsRow = { ticker?: unknown; published_at?: unknown; title?: unknown; url?: unknown };

/** Each ticker's DilutionTracker releases published before `until`, newest first, three at most. */
export function gainerHeadlines(rows: readonly GainerNewsRow[], until: number): Map<string, ProducerHeadline[]> {
  const out = new Map<string, Array<ProducerHeadline & { t: number }>>();
  for (const row of rows) {
    if (!row || typeof row.ticker !== "string" || typeof row.title !== "string") continue;
    const title = row.title.replace(/\s+/g, " ").trim();
    const t = typeof row.published_at === "string" ? Date.parse(row.published_at) : NaN;
    if (!title || !Number.isFinite(t) || t >= until) continue;
    const list = out.get(row.ticker) ?? [];
    if (list.some((h) => headlineKey(h.title) === headlineKey(title))) continue;
    list.push({
      title,
      published_at: new Date(t).toISOString(),
      source: "DilutionTracker",
      url: typeof row.url === "string" && /^https?:\/\//.test(row.url) ? row.url : null,
      t,
    });
    out.set(row.ticker, list);
  }
  return new Map(
    [...out].map(([ticker, list]) => [
      ticker,
      list
        .sort((a, b) => b.t - a.t)
        .slice(0, HEADLINES_PER_GAINER)
        .map(({ t: _t, ...h }) => h),
    ]),
  );
}

// --- The ShortScout question.

export type RoomMessageRow = {
  id: string;
  author_label: string | null;
  body: string | null;
  created_at: string;
  reply_to_id?: string | null;
  member_id?: string | null;
  guest_id?: string | null;
  bot_slug?: string | null;
  agent_id?: string | null;
  deleted_at?: string | null;
  removed?: boolean | null;
};

const URL_TEXT = /\bhttps?:\/\/\S+/gi;

/** The text without links, on one line. */
const plainText = (body: string) => body.replace(URL_TEXT, " ").replace(/\s+/g, " ").trim();

/** A human member's live top-level message that asks something in at least 20 characters. */
export function isMemberQuestion(row: RoomMessageRow) {
  if (!row || row.reply_to_id || row.deleted_at || row.removed || row.bot_slug || row.agent_id) return false;
  if (!row.member_id || typeof row.body !== "string") return false;
  const text = plainText(row.body);
  return text.includes("?") && text.length >= QUESTION_MIN_CHARS;
}

/** The first word of a display name: "Sam Ortiz" gives "Sam". */
export function firstName(label: string | null | undefined) {
  const word = (label ?? "").trim().split(/\s+/)[0] ?? "";
  return word.replace(/^@+/, "").slice(0, 28);
}

/** "@Jammie Smith, how ..." becomes "@Jammie, how ...": a tagged member shows by first name only. */
export function firstNamesOnly(body: string) {
  return body.replace(/@(\p{Lu}[\p{L}'’-]*)(?:[  ]+\p{Lu}[\p{L}'’.-]*)+/gu, "@$1");
}

const sameAuthor = (a: RoomMessageRow, b: RoomMessageRow) =>
  (!!a.member_id && a.member_id === b.member_id) || (!!a.guest_id && a.guest_id === b.guest_id);

/**
 * The newest question nobody else replied to. `replies` are the live replies to any of `messages`
 * (reply_to_id set); a reply by the asker doesn't count as an answer.
 */
export function pickQuestion(messages: readonly RoomMessageRow[], replies: readonly RoomMessageRow[]): ProducerQuestion | null {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const answered = new Set<string>();
  for (const reply of replies) {
    if (!reply?.reply_to_id || reply.deleted_at || reply.removed) continue;
    const asked = byId.get(reply.reply_to_id);
    if (asked && !sameAuthor(asked, reply)) answered.add(asked.id);
  }
  const open = messages
    .filter((m) => isMemberQuestion(m) && !answered.has(m.id) && Number.isFinite(Date.parse(m.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
  for (const m of open) {
    const name = firstName(m.author_label);
    if (!name) continue;
    return { first_name: name, body: firstNamesOnly((m.body ?? "").trim()), posted_at: new Date(Date.parse(m.created_at)).toISOString() };
  }
  return null;
}

// --- Market headlines.

// ShortScout's card (supabase/functions/market-headlines in robbooker/shortscout) keeps English
// headlines only; the same test here.
const NON_ENGLISH_MARKERS =
  /\b(nombre|actions|droits|juillet|soci[eé]t[eé]|assembl[eé]e|accionistas|acciones|derechos|julio|unternehmen|aktien|hauptversammlung|azioni|diritti|luglio)\b/i;
export function isLikelyEnglish(title: string) {
  if (NON_ENGLISH_MARKERS.test(title)) return false;
  const letters = title.match(/\p{L}/gu) ?? [];
  const ascii = title.match(/[A-Za-z]/g) ?? [];
  return ascii.length >= 8 && (!letters.length || ascii.length / letters.length >= 0.94);
}

/** Polygon's and FMP's market articles as at most ten headlines, newest first, one per headline. */
export function marketHeadlines(
  polygon: readonly PolygonArticle[],
  fmp: readonly FmpArticle[],
  max = MARKET_HEADLINES_MAX,
): ProducerMarketHeadline[] {
  const items = [...polygon.map((a) => newsItem(a)), ...fmp.map(fmpItem)].filter(
    (item): item is NewsItem => !!item && isLikelyEnglish(item.title),
  );
  items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const out: ProducerMarketHeadline[] = [];
  for (const item of items) {
    const key = headlineKey(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: item.title, source: item.source || "", url: item.url || null, published_at: item.publishedAt });
    if (out.length >= max) break;
  }
  return out;
}
