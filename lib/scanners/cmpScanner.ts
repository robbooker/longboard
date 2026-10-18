/**
 * LB Scanner: runs the CMP system (lib/cmpSystem.ts, CMP_DEFAULTS) over the
 * current top gainers on 2-minute extended-hours bars.
 *
 * One shared result lives in the Next.js data cache (unstable_cache). The
 * /api/cron/cmp-scanner cron reads it every 2 minutes during extended hours,
 * which refreshes it in the background once it is older than
 * CMP_SCAN_REVALIDATE_SECONDS; pages only ever read the cached copy.
 */
import { unstable_cache } from "next/cache";
import { aggregateToHourBars, CMP_DEFAULTS, runCmpSystem } from "@/lib/cmpSystem";
import { fetchTopGainers } from "@/lib/gainers/topGainers";
import { etDateLookbackStart, fetchBars, fetchMinuteBars } from "@/lib/polygon/bars";
import { nyClockToUtcMs } from "@/lib/polygon/client";
import type { Bar } from "@/lib/polygon/types";
import type { GainersData } from "@/types/polygon";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";
import { closedBars, cmpScannerRow, sortCmpScannerRows, type CmpScannerRow } from "./cmpScannerRows";

/** Shorter than the 2-minute cron so every cron tick finds the entry stale and refreshes it. */
export const CMP_SCAN_REVALIDATE_SECONDS = 100;
export const CMP_SCAN_BAR_MINUTES = 2;

const GAINER_LIMIT = 20;
/** Calendar days of 2m bars before today, so the 200 SMA is warm at the open of premarket. */
const BAR_LOOKBACK_DAYS = 5;
const TICKER_BATCH_SIZE = 5;
const HOUR_HISTORY_REVALIDATE_SECONDS = 6 * 60 * 60;

export type CmpScanResult = {
  etDate: string;
  fetchedAt: string;
  mode: GainersData["mode"] | null;
  barMinutes: number;
  settings: { version: number; proxPct: number; dipTolPct: number };
  rows: CmpScannerRow[];
  errors: { ticker: string; error: string }[];
};

function parseIso(etDateIso: string) {
  const [year, month, day] = etDateIso.split("-").map(Number);
  return { year, month, day };
}

/**
 * Hour bars from the 1st of the previous month up to the 2m window (for the
 * CMP and month-to-date Ghost). They don't change during the day, so they are
 * cached per ticker and window.
 */
const fetchHourHistory = unstable_cache(
  async (ticker: string, fromMs: number, toMs: number): Promise<Bar[]> =>
    fetchBars({ ticker, fromMs, toMs, resolution: "1h" }),
  ["cmp-scanner-hour-history"],
  { revalidate: HOUR_HISTORY_REVALIDATE_SECONDS },
);

async function scanTicker(
  ticker: { ticker: string; changePct: number },
  etDate: string,
  nowMs: number,
): Promise<CmpScannerRow | null> {
  const today = parseIso(etDate);
  const start = parseIso(etDateLookbackStart(etDate, BAR_LOOKBACK_DAYS));
  const barsFromMs = nyClockToUtcMs(start.year, start.month, start.day, 4, 0);
  const barsToMs = Math.min(nyClockToUtcMs(today.year, today.month, today.day, 20, 0) - 1, nowMs);
  const prevMonth = new Date(Date.UTC(today.year, today.month - 2, 1));
  const hoursFromMs = nyClockToUtcMs(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth() + 1, 1, 0, 0);

  const [rawBars, hourHistory] = await Promise.all([
    fetchMinuteBars({ ticker: ticker.ticker, fromMs: barsFromMs, toMs: barsToMs, minutes: CMP_SCAN_BAR_MINUTES }),
    fetchHourHistory(ticker.ticker, hoursFromMs, barsFromMs - 1),
  ]);
  const bars = closedBars(rawBars, CMP_SCAN_BAR_MINUTES * 60, Math.floor(nowMs / 1000));
  if (bars.length === 0) return null;

  const result = runCmpSystem({
    bars,
    hourBars: [...hourHistory, ...aggregateToHourBars(bars)],
    settings: CMP_DEFAULTS,
  });
  return cmpScannerRow(ticker, bars, result);
}

export async function runCmpScan(now = new Date()): Promise<CmpScanResult> {
  const etDate = mostRecentTradingDay(now);
  const gainers = await fetchTopGainers({ limit: GAINER_LIMIT, now });
  const rows: CmpScannerRow[] = [];
  const errors: CmpScanResult["errors"] = [];

  for (let i = 0; i < gainers.tickers.length; i += TICKER_BATCH_SIZE) {
    const batch = gainers.tickers.slice(i, i + TICKER_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.allSettled(
      batch.map((t) => scanTicker({ ticker: t.ticker, changePct: t.todaysChangePerc }, etDate, now.getTime())),
    );
    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        if (r.value) rows.push(r.value);
      } else {
        errors.push({
          ticker: batch[j].ticker,
          error: r.reason instanceof Error ? r.reason.message.slice(0, 160) : "scan_failed",
        });
      }
    });
  }

  return {
    etDate,
    fetchedAt: new Date().toISOString(),
    mode: gainers.mode ?? null,
    barMinutes: CMP_SCAN_BAR_MINUTES,
    settings: { version: CMP_DEFAULTS.version, proxPct: CMP_DEFAULTS.proxPct, dipTolPct: CMP_DEFAULTS.dipTolPct },
    rows: sortCmpScannerRows(rows),
    errors,
  };
}

/** The one shared scan result. Stale reads return the cached copy and refresh in the background. */
export const getCachedCmpScan = unstable_cache(() => runCmpScan(), ["cmp-scanner-v1"], {
  revalidate: CMP_SCAN_REVALIDATE_SECONDS,
  tags: ["cmp-scanner"],
});
