// #528 Gainer Balloons: the day's gainers with their 2-minute bars, for /api/chat/balloons.
//
// Which stocks: the Gainers Table's own list for the day (public.chat_gainers_table: the stocks that
// alerted in the gainers room, with the country and float saved with their company facts), with the
// table's own rule for leaving a stock off (#433). At most MAX_BALLOONS of them.
// Which day: today in New York when it has gainers; otherwise the most recent day that had any (a
// weekend, a holiday, or early morning before the first alert), so the picture is never empty
// while there is a day to show. The answer always says which day it is.
// Bars and yesterday's close: Polygon, read once per stock for everyone on this server:
//   - bars for today: at most once a minute per stock (BARS_TTL_MS); a finished day: once in six hours;
//   - yesterday's close: once a day per stock (an hour when Polygon had none).
// So with the list full, the most this server asks Polygon while the market is open is 60 bar reads
// a minute (one a second), however many members are watching, plus 60 daily-bar reads once a day.
// A slow or failed read never holds the picture up: the stock keeps the bars it had (or comes back
// with none and shows as not yet traded) and is asked for again after the same wait.
// The key never leaves the server and is never written to an error or a log.
import type { SupabaseClient } from "@supabase/supabase-js";
import { easternDay, gainersRowLeftOff, type GainersTableDbRow } from "@/lib/chatGainersFacts";
import { gainersSnapshots } from "@/lib/chatGainersQuotes";
import { nyClockToUtcMs, polygonAggsAll } from "@/lib/polygon/client";
import { MAX_BALLOONS } from "./config";
import type { BalloonsFeed, RawBar } from "./data";

export const BARS_TTL_MS = 60_000;
export const BARS_DONE_TTL_MS = 6 * 3_600_000;
export const PREV_CLOSE_TTL_MS = 24 * 3_600_000;
export const PREV_CLOSE_MISSING_TTL_MS = 3_600_000;
export const ROWS_TTL_MS = 30_000;
export const PAST_DAY_TTL_MS = 5 * 60_000;
/** The answer goes out after this long even if Polygon hasn't finished; late answers fill the cache. */
export const FEED_WAIT_MS = 8_000;
/** How many days back to look for the most recent day with gainers. */
export const LOOK_BACK_DAYS = 10;
/** A Polygon read that hasn't answered by now counts as failed, so it can't hold a place in the queue. */
export const UPSTREAM_TIMEOUT_MS = 12_000;
const PARALLEL = 8;
const BAR_MINUTES = 2;

type Db = Pick<SupabaseClient, "rpc">;
type Row = Pick<GainersTableDbRow, "ticker" | "alerts" | "country" | "float_shares" | "any_not_after_hours" | "after_hours_high">;

const dayParts = (day: string) => day.split("-").map(Number) as [number, number, number];
function shiftDay(day: string, days: number) {
  const [y, m, d] = dayParts(day);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const isWeekend = (day: string) => {
  const [y, m, d] = dayParts(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() % 6 === 0;
};
/** 4:00 AM and 8:00 PM New York on a day, as instants. */
export function dayWindow(day: string) {
  const [y, m, d] = dayParts(day);
  return { startMs: nyClockToUtcMs(y, m, d, 4, 0), endMs: nyClockToUtcMs(y, m, d, 20, 0) };
}

function inTime<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timed out")), UPSTREAM_TIMEOUT_MS)));
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

// --- A small work queue, so a cold start asks Polygon for a few stocks at a time, not sixty at once.
const queue: Array<() => Promise<void>> = [];
let running = 0;
function pump() {
  while (running < PARALLEL && queue.length) {
    const job = queue.shift()!;
    running++;
    void job().finally(() => {
      running--;
      pump();
    });
  }
}
function enqueue(job: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    queue.push(() => job().then(resolve, resolve));
    pump();
  });
}

// --- The day's list of stocks.
type RowsEntry = { at: number; rows: Row[] };
const rowsCache = new Map<string, RowsEntry>();
const rowsPending = new Map<string, Promise<Row[] | null>>();

async function dayRows(db: Db, day: string, ttl: number, now: number): Promise<Row[] | null> {
  const cached = rowsCache.get(day);
  if (cached && now - cached.at < ttl) return cached.rows;
  let pending = rowsPending.get(day);
  if (!pending) {
    pending = (async () => {
      try {
        const { data, error } = await db.rpc("chat_gainers_table", { p_day: day });
        if (error) return cached?.rows ?? null;
        const rows = ((data ?? []) as Row[]).filter((row) => typeof row?.ticker === "string" && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(row.ticker));
        rowsCache.set(day, { at: Date.now(), rows });
        return rows;
      } catch {
        return cached?.rows ?? null;
      } finally {
        rowsPending.delete(day);
      }
    })();
    rowsPending.set(day, pending);
  }
  return pending;
}

/** The day to show and its stocks. Null: the list could not be read at all. */
async function pickDay(db: Db, now: number): Promise<{ day: string; today: string; rows: Row[] } | null> {
  const today = easternDay(now);
  const todays = await dayRows(db, today, ROWS_TTL_MS, now);
  if (todays === null) return null;
  if (todays.length) return { day: today, today, rows: todays };
  for (let back = 1; back <= LOOK_BACK_DAYS; back++) {
    const day = shiftDay(today, -back);
    if (isWeekend(day)) continue;
    const rows = await dayRows(db, day, PAST_DAY_TTL_MS, now);
    if (rows?.length) return { day, today, rows };
  }
  return { day: today, today, rows: [] };
}

// --- Bars and yesterday's close, per stock and day.
type BarsEntry = { at: number; bars: RawBar[]; ttl: number };
const barsCache = new Map<string, BarsEntry>();
const barsPending = new Map<string, Promise<void>>();
type CloseEntry = { at: number; close: number | null };
const closeCache = new Map<string, CloseEntry>();
const closePending = new Map<string, Promise<void>>();

function readBars(ticker: string, day: string): Promise<void> {
  const key = `${day}:${ticker}`;
  const held = barsPending.get(key);
  if (held) return held;
  const { startMs, endMs } = dayWindow(day);
  const read = enqueue(async () => {
    const previous = barsCache.get(key);
    try {
      const aggs = await inTime(polygonAggsAll(ticker, BAR_MINUTES, "minute", startMs, endMs - 1));
      const bars = aggs.filter((a) => a.t >= startMs && a.t < endMs).map((a): RawBar => [a.t, a.o, a.h, a.l, a.c, a.v]);
      const at = Date.now();
      // A day is finished five minutes after 8:00 PM: its bars no longer change.
      barsCache.set(key, { at, bars, ttl: at > endMs + 5 * 60_000 ? BARS_DONE_TTL_MS : BARS_TTL_MS });
    } catch {
      // No key, Polygon down or refusing: keep what there was, and wait a minute before asking again.
      barsCache.set(key, { at: Date.now(), bars: previous?.bars ?? [], ttl: BARS_TTL_MS });
    }
  }).finally(() => barsPending.delete(key));
  barsPending.set(key, read);
  return read;
}

function readPrevClose(ticker: string, day: string): Promise<void> {
  const key = `${day}:${ticker}`;
  const held = closePending.get(key);
  if (held) return held;
  const read = enqueue(async () => {
    let close: number | null = null;
    try {
      // The last daily bar before the day: yesterday's close, or Friday's on a Monday, whatever the holidays.
      const daily = await inTime(polygonAggsAll(ticker, 1, "day", shiftDay(day, -10), shiftDay(day, -1)));
      const last = daily[daily.length - 1];
      close = last && last.c > 0 ? last.c : null;
    } catch {
      close = closeCache.get(key)?.close ?? null;
    }
    closeCache.set(key, { at: Date.now(), close });
  }).finally(() => closePending.delete(key));
  closePending.set(key, read);
  return read;
}

const num = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * At most `cap` rows. Over the cap, the stocks with the most volume today stay (from the Gainers
 * Table's own quotes when it is today); without a volume, the ones that alerted most.
 */
export function capRows<T extends { ticker: string; alerts: number }>(rows: T[], volumes: Map<string, number | null>, cap = MAX_BALLOONS): T[] {
  if (rows.length <= cap) return rows;
  return [...rows]
    .sort((a, b) => (volumes.get(b.ticker) ?? -1) - (volumes.get(a.ticker) ?? -1) || b.alerts - a.alerts || a.ticker.localeCompare(b.ticker))
    .slice(0, cap);
}

function sweep(now: number) {
  if (barsCache.size > 600) for (const [key, entry] of barsCache) if (now - entry.at > BARS_DONE_TTL_MS) barsCache.delete(key);
  if (closeCache.size > 2_000) for (const [key, entry] of closeCache) if (now - entry.at > PREV_CLOSE_TTL_MS) closeCache.delete(key);
  if (rowsCache.size > 40) for (const [key, entry] of rowsCache) if (now - entry.at > PAST_DAY_TTL_MS) rowsCache.delete(key);
}

/**
 * The feed for the page. `since` (epoch ms): send only bars from that time on, with a count of each
 * stock's earlier bars so the browser can tell whether they fit what it holds.
 * Null when the day's list can't be read.
 */
export async function balloonsFeed(db: Db, { since = null, now = Date.now() }: { since?: number | null; now?: number } = {}): Promise<BalloonsFeed | null> {
  const picked = await pickDay(db, now);
  if (!picked) return null;
  const { day, today } = picked;
  let rows = picked.rows;
  if (rows.length > MAX_BALLOONS) {
    const volumes = new Map<string, number | null>();
    if (day === today) {
      const snapshots = await gainersSnapshots(rows.map((row) => row.ticker)).catch(() => null);
      for (const [ticker, snapshot] of snapshots ?? []) volumes.set(ticker, snapshot.quote?.volume ?? null);
    }
    rows = capRows(rows, volumes);
  }

  const waits: Promise<void>[] = [];
  for (const row of rows) {
    const key = `${day}:${row.ticker}`;
    const bars = barsCache.get(key);
    if (!bars || now - bars.at >= bars.ttl) waits.push(readBars(row.ticker, day));
    const close = closeCache.get(key);
    if (!close || now - close.at >= (close.close === null ? PREV_CLOSE_MISSING_TTL_MS : PREV_CLOSE_TTL_MS)) waits.push(readPrevClose(row.ticker, day));
  }
  if (waits.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(waits), new Promise((resolve) => (timer = setTimeout(resolve, FEED_WAIT_MS)))]);
    clearTimeout(timer);
  }
  sweep(now);

  const { startMs } = dayWindow(day);
  const from = since !== null && Number.isFinite(since) && since > startMs ? since : null;
  const stocks: BalloonsFeed["stocks"] = [];
  for (const row of rows) {
    const key = `${day}:${row.ticker}`;
    const prevClose = closeCache.get(key)?.close ?? null;
    // The Gainers Table's rule (#433): a stock that only bounced after hours, still under yesterday's close, is not a gainer.
    if (gainersRowLeftOff(row, prevClose)) continue;
    const bars = barsCache.get(key)?.bars ?? [];
    const first = from === null ? 0 : bars.findIndex((bar) => bar[0] >= from);
    const sent = from === null ? bars : first < 0 ? [] : bars.slice(first);
    stocks.push({
      ticker: row.ticker,
      country: typeof row.country === "string" && row.country.trim() ? row.country.trim().slice(0, 60) : null,
      floatShares: num(row.float_shares),
      prevClose,
      earlier: bars.length - sent.length,
      bars: sent,
    });
  }
  return { day, today, now: Date.now(), barMinutes: BAR_MINUTES, since: from, stocks };
}

/** For tests. */
export function resetBalloonsFeed() {
  rowsCache.clear();
  rowsPending.clear();
  barsCache.clear();
  barsPending.clear();
  closeCache.clear();
  closePending.clear();
  queue.length = 0;
  running = 0;
}
