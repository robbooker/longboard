import { nyClockToUtcMs, polygonGet } from "./client";
import type { Bar } from "./types";

type AggResult = {
  t?: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
};

type AggsResponse = {
  results?: AggResult[];
  resultsCount?: number;
  status?: string;
};

/** Resolutions exposed in the chart UI today. The string form ("1m"/"5m"/"1h"/"4h"/"1d")
 *  is the URL-friendly shape; the multiplier/timespan is what Polygon's aggs
 *  API expects. */
export type Resolution = "1m" | "5m" | "1h" | "4h" | "1d";
export type IntradayResolution = Exclude<Resolution, "1d">;

export const CHART_RESOLUTIONS = ["1m", "5m", "1h", "4h", "1d"] as const satisfies readonly Resolution[];

const RESOLUTION_AGG: Record<Resolution, { multiplier: number; timespan: "minute" | "hour" | "day" }> = {
  "1m": { multiplier: 1, timespan: "minute" },
  "5m": { multiplier: 5, timespan: "minute" },
  "1h": { multiplier: 1, timespan: "hour" },
  "4h": { multiplier: 4, timespan: "hour" },
  "1d": { multiplier: 1, timespan: "day" },
};

const DAILY_LOOKBACK_CALENDAR_DAYS = 420;
const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type FetchBarsOptions = {
  ticker: string;
  fromMs: number;
  toMs: number;
  resolution?: Resolution;
  extendedHours?: boolean;
};

// Fetch aggregate bars from Polygon at the requested resolution.
// Returns Bar[] with `time` as unix SECONDS (UTC) — the unit Lightweight Charts expects.
export async function fetchBars(opts: FetchBarsOptions): Promise<Bar[]> {
  const { ticker, fromMs, toMs, resolution = "1m", extendedHours = true } = opts;
  const { multiplier, timespan } = RESOLUTION_AGG[resolution];
  const extendedHoursParam =
    timespan === "minute" ? `&extended_hours=${extendedHours}` : "";
  const path =
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${fromMs}/${toMs}` +
    `?adjusted=true${extendedHoursParam}&sort=asc&limit=50000`;
  const data = await polygonGet<AggsResponse>(path);
  const rows = data.results ?? [];
  const bars: Bar[] = [];
  for (const r of rows) {
    if (
      typeof r.t !== "number" ||
      typeof r.o !== "number" ||
      typeof r.h !== "number" ||
      typeof r.l !== "number" ||
      typeof r.c !== "number"
    ) {
      continue;
    }
    bars.push({
      time: Math.floor(r.t / 1000),
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: typeof r.v === "number" ? r.v : 0,
    });
  }
  return bars;
}

function parseEtDateIso(etDateIso: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(etDateIso);
  if (!m) {
    throw new Error(
      `invalid ET date "${etDateIso}", expected YYYY-MM-DD`,
    );
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
  };
}

function shiftDateIso(etDateIso: string, days: number): string {
  const { year, month, day } = parseEtDateIso(etDateIso);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function etDateLookbackStart(etDateIso: string, calendarDays: number): string {
  return shiftDateIso(etDateIso, -Math.max(0, calendarDays));
}

function aggregateDailyBar(bars: Bar[]): Bar | null {
  if (bars.length === 0) return null;
  return {
    time: bars[0].time,
    open: bars[0].open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    close: bars[bars.length - 1].close,
    volume: bars.reduce((sum, bar) => sum + bar.volume, 0),
  };
}

function formatEtDateIso(unixSeconds: number): string {
  return ET_DATE_FMT.format(new Date(unixSeconds * 1000));
}

function mergeDevelopingDailyBar(
  dailyBars: Bar[],
  etDateIso: string,
  developingBar: Bar | null,
): Bar[] {
  if (!developingBar) return dailyBars;
  const withoutCurrentDay = dailyBars.filter(
    (bar) => formatEtDateIso(bar.time) !== etDateIso,
  );
  return [...withoutCurrentDay, developingBar].sort((a, b) => a.time - b.time);
}

export async function fetchDailyBarsEndingOn(
  ticker: string,
  etDateIso: string,
): Promise<Bar[]> {
  const { year, month, day } = parseEtDateIso(etDateIso);
  const fromIso = shiftDateIso(etDateIso, -DAILY_LOOKBACK_CALENDAR_DAYS);
  const from = parseEtDateIso(fromIso);
  const fromMs = nyClockToUtcMs(from.year, from.month, from.day, 0, 0);
  const toMs = nyClockToUtcMs(year, month, day, 23, 59);
  const dailyBars = await fetchBars({
    ticker,
    fromMs,
    toMs,
    resolution: "1d",
    extendedHours: false,
  });

  const intradayBars = await fetchBarsForDay(ticker, etDateIso, "1m");
  const developingBar = aggregateDailyBar(intradayBars);
  return mergeDevelopingDailyBar(dailyBars, etDateIso, developingBar);
}

// Fetch all bars at the requested resolution for a single ET trading day,
// including pre-market (4:00am ET) and after-hours (8:00pm ET). The day is
// interpreted in ET so DST is handled correctly.
export async function fetchBarsForDay(
  ticker: string,
  etDateIso: string,
  resolution: Resolution = "1m",
): Promise<Bar[]> {
  if (resolution === "1d") {
    return fetchDailyBarsEndingOn(ticker, etDateIso);
  }
  const { year, month, day } = parseEtDateIso(etDateIso);
  const fromMs = nyClockToUtcMs(year, month, day, 4, 0);
  const toMs = nyClockToUtcMs(year, month, day, 20, 0) - 1;
  return fetchBars({ ticker, fromMs, toMs, resolution, extendedHours: true });
}

export async function fetchBarsForLookback(
  ticker: string,
  etDateIso: string,
  resolution: IntradayResolution,
  lookbackCalendarDays: number,
): Promise<Bar[]> {
  const { year, month, day } = parseEtDateIso(etDateIso);
  const fromIso = etDateLookbackStart(etDateIso, lookbackCalendarDays);
  const from = parseEtDateIso(fromIso);
  const fromMs = nyClockToUtcMs(from.year, from.month, from.day, 4, 0);
  const toMs = nyClockToUtcMs(year, month, day, 20, 0) - 1;
  return fetchBars({ ticker, fromMs, toMs, resolution, extendedHours: true });
}
