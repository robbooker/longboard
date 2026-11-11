import { polygonFetch } from "@/lib/polygon-api";

// #442 Gainers Table: shares outstanding for each ticker, from Polygon's ticker details
// (/v3/reference/tickers/{ticker}), so the table can show a live market cap: the price it shows times
// these shares. Shares only change with a filing, so each ticker is read once a day per server
// instance (a module-level cache, like the quotes), not on every 15-second read. A ticker Polygon
// has no count for is asked again after an hour. A slow lookup never holds up the table: its market
// cap shows "—" and fills in on a later read.
//
// Which count: weighted_shares_outstanding, else share_class_shares_outstanding. The weighted count
// is the whole company's shares expressed in this ticker's class, which is what a market cap is
// (Polygon's own market_cap uses it too, as does the morning email in lib/morning-email/polygon.ts).
// The share-class count only counts this one class, so for a company with two classes it would show
// part of the company. Small caps nearly always have one class, where the two are the same.

export const SHARES_TTL_MS = 24 * 3_600_000;
/** A ticker with no count (or a failed read) is asked again after this long. */
export const SHARES_MISSING_TTL_MS = 3_600_000;
/** The table answers after this long even if Polygon hasn't; the late answer fills the cache. */
export const SHARES_WAIT_MS = 3_000;
/** Ticker details are one request per ticker: at most this many at once. */
const PARALLEL = 6;

type Details = { weighted_shares_outstanding?: unknown; share_class_shares_outstanding?: unknown };

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** The shares outstanding to use from one ticker's details: weighted, else the share class's; null without either. */
export function sharesFromDetails(details: Details | null | undefined): number | null {
  if (!details) return null;
  if (positive(details.weighted_shares_outstanding)) return details.weighted_shares_outstanding;
  if (positive(details.share_class_shares_outstanding)) return details.share_class_shares_outstanding;
  return null;
}

type Entry = { at: number; shares: number | null };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<void>>();
const queue: string[] = [];
let running = 0;

const fresh = (entry: Entry | undefined, now: number) =>
  !!entry && now - entry.at < (entry.shares === null ? SHARES_MISSING_TTL_MS : SHARES_TTL_MS);

async function readOne(ticker: string) {
  let shares: number | null = null;
  try {
    const body = await polygonFetch<{ results?: Details }>(
      `/v3/reference/tickers/${encodeURIComponent(ticker)}`,
    );
    shares = sharesFromDetails(body?.results);
  } catch {
    // No key, Polygon down or no such ticker: "—" until it is asked again.
  }
  cache.set(ticker, { at: Date.now(), shares });
}

const waiters = new Map<string, () => void>();

function pump() {
  while (running < PARALLEL && queue.length) {
    const ticker = queue.shift()!;
    running++;
    readOne(ticker).finally(() => {
      running--;
      pending.delete(ticker);
      waiters.get(ticker)?.();
      waiters.delete(ticker);
      pump();
    });
  }
}

/** Shares outstanding for these tickers (null when unknown), from the cache when fresh. */
export async function gainersShares(tickers: string[]): Promise<Map<string, number | null>> {
  const wanted = [...new Set(tickers)];
  const now = Date.now();
  for (const ticker of wanted) {
    if (pending.has(ticker) || fresh(cache.get(ticker), now)) continue;
    pending.set(ticker, new Promise<void>((resolve) => waiters.set(ticker, resolve)));
    queue.push(ticker);
  }
  pump();
  const waits = wanted.map((t) => pending.get(t)).filter(Boolean);
  if (waits.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(waits),
      new Promise((resolve) => (timer = setTimeout(resolve, SHARES_WAIT_MS))),
    ]);
    clearTimeout(timer);
  }
  if (cache.size > 2_000) for (const [t, e] of cache) if (now - e.at > SHARES_TTL_MS) cache.delete(t);
  return new Map(wanted.map((t) => [t, cache.get(t)?.shares ?? null]));
}

/** For tests. */
export function resetGainersShares() {
  cache.clear();
  pending.clear();
  waiters.clear();
  queue.length = 0;
  running = 0;
}
