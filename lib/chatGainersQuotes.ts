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
  lastTrade?: { p?: number };
  min?: { c?: number; av?: number; v?: number };
  day?: { c?: number; v?: number };
  prevDay?: { c?: number };
};

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * One snapshot as the table shows it.
 * - price: the latest trade, else the latest minute's close, else today's close so far.
 * - changePct: Polygon's todaysChangePerc, which is against the previous close and moves pre-market.
 *   #417: pre-market Polygon often sends no last trade and todaysChangePerc 0 while min.c and
 *   prevDay.c are both there (PEPG 5.11 against 2.39 read 0%). When its figure is 0 or missing, work
 *   it out from the price above and the previous close.
 * - volume: the largest of day.v, min.av and min.v. Pre-market, day.v stays 0 (or lags) while
 *   min.av, the day's accumulated volume as of the latest minute bar, already counts pre-market
 *   shares; in regular hours day.v catches up. Same rule as the scanners (lib/scanners/snapshotVolume).
 */
export function quoteFromSnapshot(snapshot: Snapshot): GainersQuote {
  const price = [snapshot.lastTrade?.p, snapshot.min?.c, snapshot.day?.c].find(positive) ?? null;
  const sent = snapshot.todaysChangePerc;
  const prevClose = snapshot.prevDay?.c;
  const change =
    typeof sent === "number" && Number.isFinite(sent) && sent !== 0
      ? sent
      : price !== null && positive(prevClose)
        ? ((price - prevClose) / prevClose) * 100
        : sent;
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
