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

/** Resolutions exposed in the chart UI today. The string form ("1m"/"5m")
 *  is the URL-friendly shape; the multiplier is what Polygon's aggs API
 *  expects. */
export type Resolution = "1m" | "5m";

const RESOLUTION_MULTIPLIER: Record<Resolution, number> = {
  "1m": 1,
  "5m": 5,
};

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
  const multiplier = RESOLUTION_MULTIPLIER[resolution];
  const path =
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/minute/${fromMs}/${toMs}` +
    `?adjusted=true&extended_hours=${extendedHours}&sort=asc&limit=50000`;
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

// Fetch all bars at the requested resolution for a single ET trading day,
// including pre-market (4:00am ET) and after-hours (8:00pm ET). The day is
// interpreted in ET so DST is handled correctly.
export async function fetchBarsForDay(
  ticker: string,
  etDateIso: string,
  resolution: Resolution = "1m",
): Promise<Bar[]> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(etDateIso);
  if (!m) throw new Error(`fetchBarsForDay: invalid ET date "${etDateIso}", expected YYYY-MM-DD`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const fromMs = nyClockToUtcMs(year, month, day, 4, 0);
  const toMs = nyClockToUtcMs(year, month, day, 20, 0) - 1;
  return fetchBars({ ticker, fromMs, toMs, resolution, extendedHours: true });
}
