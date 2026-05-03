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

export type FetchMinuteBarsOptions = {
  ticker: string;
  fromMs: number;
  toMs: number;
  extendedHours?: boolean;
};

// Fetch 1-minute aggregate bars from Polygon.
// Returns Bar[] with `time` as unix SECONDS (UTC) — the unit Lightweight Charts expects.
export async function fetchMinuteBars(opts: FetchMinuteBarsOptions): Promise<Bar[]> {
  const { ticker, fromMs, toMs, extendedHours = true } = opts;
  const path =
    `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${fromMs}/${toMs}` +
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

// Fetch all 1-minute bars for a single ET trading day, including pre-market (4:00am ET) and
// after-hours (8:00pm ET). The day is interpreted in ET so DST is handled correctly.
export async function fetchMinuteBarsForDay(ticker: string, etDateIso: string): Promise<Bar[]> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(etDateIso);
  if (!m) throw new Error(`fetchMinuteBarsForDay: invalid ET date "${etDateIso}", expected YYYY-MM-DD`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const fromMs = nyClockToUtcMs(year, month, day, 4, 0);
  const toMs = nyClockToUtcMs(year, month, day, 20, 0) - 1;
  return fetchMinuteBars({ ticker, fromMs, toMs, extendedHours: true });
}
