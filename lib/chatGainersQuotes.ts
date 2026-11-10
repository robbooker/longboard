import { polygonFetch } from "@/lib/polygon-api";
import { snapshotCumulativeVolume } from "@/lib/scanners/snapshotVolume";
import type { GainersQuote } from "@/lib/chatGainersFacts";

// #372 Gainers Table: price, % today and volume today for the table's tickers, from Polygon's stock
// snapshot. Every viewer's table polls every 15 seconds, so the snapshot is read once per ticker per
// 15 seconds for everyone (a module-level cache on each server instance), many tickers in one
// request. A failed or slow snapshot never holds up the table: those cells show "—".

export const QUOTE_TTL_MS = 15_000;
/** The table answers after this long even if Polygon hasn't; the late answer fills the cache. */
export const QUOTE_WAIT_MS = 4_000;
/** Tickers per snapshot request, to keep the address a sensible length. */
const BATCH = 100;

type Snapshot = {
  ticker?: string;
  todaysChangePerc?: number;
  lastTrade?: { p?: number; t?: number };
  min?: { c?: number; av?: number; v?: number; t?: number };
  day?: { c?: number; v?: number };
  prevDay?: { c?: number };
};

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * The price right now. Polygon's last trade stops at the regular close for most stocks: after hours
 * (and pre-market) the trades keep coming but only the minute bar follows them (#430: FOSL's last
 * trade read 7.90 from 3:59 PM while its 4:22 PM minute bar closed at 9.99). So when both carry a
 * time, the newer one wins: lastTrade.t is in nanoseconds, min.t is the start of a one-minute bar in
 * milliseconds. Without both times it is the old order: last trade, else minute close, else day close.
 */
function priceNow(snapshot: Snapshot) {
  const last = snapshot.lastTrade?.p;
  const minute = snapshot.min?.c;
  const lastAt = snapshot.lastTrade?.t;
  const minuteAt = snapshot.min?.t;
  if (positive(last) && positive(minute) && positive(lastAt) && positive(minuteAt) && minuteAt + 60_000 > lastAt / 1e6)
    return minute;
  return [last, minute, snapshot.day?.c].find(positive) ?? null;
}

/**
 * One snapshot as the table shows it.
 * - price: the newer of the latest trade and the latest minute's close (see priceNow), else today's
 *   close so far.
 * - changePct: that price against the previous close (prevDay.c), so it is the gain since yesterday's
 *   close at any hour: pre-market, regular hours and after hours. #430: Polygon's own
 *   todaysChangePerc is worked out from its last trade, which stops at the close (FOSL read -2.0%
 *   while it traded 24% above yesterday's close), and #417: pre-market it is often 0. Polygon's
 *   figure is only the fallback, for when the price or the previous close is missing.
 * - volume: the largest of day.v, min.av and min.v. Pre-market, day.v stays 0 (or lags) while
 *   min.av, the day's accumulated volume as of the latest minute bar, already counts pre-market
 *   shares; in regular hours day.v catches up. Same rule as the scanners (lib/scanners/snapshotVolume).
 */
export function quoteFromSnapshot(snapshot: Snapshot): GainersQuote {
  const price = priceNow(snapshot);
  const prevClose = snapshot.prevDay?.c;
  const change = price !== null && positive(prevClose) ? ((price - prevClose) / prevClose) * 100 : snapshot.todaysChangePerc;
  const volume = snapshotCumulativeVolume(snapshot);
  return {
    price,
    changePct: typeof change === "number" && Number.isFinite(change) ? change : null,
    volume: volume > 0 ? volume : null,
  };
}

type Entry = { at: number; quote: GainersQuote | null };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<void>>();

async function readBatch(tickers: string[]) {
  let found = new Map<string, GainersQuote>();
  try {
    const list = tickers.map(encodeURIComponent).join(",");
    const body = await polygonFetch<{ tickers?: Snapshot[] }>(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${list}`);
    found = new Map(
      (Array.isArray(body?.tickers) ? body.tickers : [])
        .filter((s) => s && typeof s.ticker === "string")
        .map((s) => [s.ticker as string, quoteFromSnapshot(s)]),
    );
  } catch {
    // No key, Polygon down or refusing: these tickers show "—" until the next read.
  }
  const at = Date.now();
  for (const ticker of tickers) cache.set(ticker, { at, quote: found.get(ticker) ?? null });
}

/** Quotes for these tickers, from the cache when fresh, otherwise one snapshot request per 100. */
export async function gainersQuotes(tickers: string[]): Promise<Map<string, GainersQuote | null>> {
  const wanted = [...new Set(tickers)];
  const now = Date.now();
  const stale = wanted.filter((t) => !pending.has(t) && !(now - (cache.get(t)?.at ?? -Infinity) < QUOTE_TTL_MS));
  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH);
    const read = readBatch(batch).finally(() => batch.forEach((t) => pending.delete(t)));
    batch.forEach((t) => pending.set(t, read));
  }
  const waits = [...new Set(wanted.map((t) => pending.get(t)).filter(Boolean))];
  if (waits.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(waits), new Promise((resolve) => (timer = setTimeout(resolve, QUOTE_WAIT_MS)))]);
    clearTimeout(timer);
  }
  if (cache.size > 2_000) for (const [t, e] of cache) if (now - e.at > 10 * 60_000) cache.delete(t);
  return new Map(wanted.map((t) => [t, cache.get(t)?.quote ?? null]));
}

/** For tests. */
export function resetGainersQuotes() {
  cache.clear();
  pending.clear();
}
