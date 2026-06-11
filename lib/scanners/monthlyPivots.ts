import { fetchBars } from "@/lib/polygon/bars";
import { nyClockToUtcMs } from "@/lib/polygon/client";
import type { Bar } from "@/lib/polygon/types";

export type MissedMonthlyPivot = {
  price: number;
  sourceMonth: string;
  sourceMonthLabel: string;
  activeMonth: string;
  activeMonthLabel: string;
  activeFromDate: string;
  lastCheckedDate: string;
};

export type MonthlyPivotScan = {
  target: MissedMonthlyPivot | null;
  countAbovePrice: number;
  pivotsAbovePrice: MissedMonthlyPivot[];
};

export type MonthlyPivotEnrichment = {
  monthlyPivotTarget: MissedMonthlyPivot | null;
  monthlyPivotCount: number;
  monthlyPivotError: string | null;
};

export const DEFAULT_MONTHLY_PIVOT_LOOKBACK_MONTHS = 36;
const DEFAULT_BATCH_SIZE = 8;
const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const MONTH_LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

type MonthBucket = {
  key: string;
  year: number;
  month: number;
  high: number;
  low: number;
  close: number;
};

function parseEtDateIso(etDateIso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(etDateIso);
  if (!match) {
    throw new Error(`Invalid ET date "${etDateIso}", expected YYYY-MM-DD`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function etDateOf(unixSeconds: number): string {
  return ET_DATE_FMT.format(new Date(unixSeconds * 1000));
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthKeyFromDate(etDateIso: string): string {
  const { year, month } = parseEtDateIso(etDateIso);
  return monthKey(year, month);
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function firstDayOfMonthIso(year: number, month: number): string {
  return `${monthKey(year, month)}-01`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return MONTH_LABEL_FMT.format(new Date(Date.UTC(year, month - 1, 1)));
}

function buildMonthBuckets(bars: Bar[], throughEtDate: string): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>();

  for (const bar of bars) {
    const etDate = etDateOf(bar.time);
    if (etDate > throughEtDate) continue;
    const { year, month } = parseEtDateIso(etDate);
    const key = monthKey(year, month);
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, {
        key,
        year,
        month,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
      continue;
    }

    existing.high = Math.max(existing.high, bar.high);
    existing.low = Math.min(existing.low, bar.low);
    existing.close = bar.close;
  }

  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function wasPivotTouched(
  bars: Bar[],
  pivotPrice: number,
  activeFromDate: string,
  throughEtDate: string,
): boolean {
  return bars.some((bar) => {
    const etDate = etDateOf(bar.time);
    if (etDate < activeFromDate || etDate > throughEtDate) return false;
    return bar.low <= pivotPrice && bar.high >= pivotPrice;
  });
}

export function findAllMissedMonthlyPivotsFromDailyBars(
  bars: Bar[],
  throughEtDate: string,
): MissedMonthlyPivot[] {
  const currentMonth = monthKeyFromDate(throughEtDate);
  const months = buildMonthBuckets(bars, throughEtDate);
  const missed: MissedMonthlyPivot[] = [];

  for (const source of months) {
    const active = addMonths(source.year, source.month, 1);
    const activeMonth = monthKey(active.year, active.month);
    if (activeMonth > currentMonth) continue;

    const pivotPrice = (source.high + source.low + source.close) / 3;
    const activeFromDate = firstDayOfMonthIso(active.year, active.month);
    if (wasPivotTouched(bars, pivotPrice, activeFromDate, throughEtDate)) continue;

    missed.push({
      price: pivotPrice,
      sourceMonth: source.key,
      sourceMonthLabel: monthLabel(source.key),
      activeMonth,
      activeMonthLabel: monthLabel(activeMonth),
      activeFromDate,
      lastCheckedDate: throughEtDate,
    });
  }

  return missed.sort((a, b) => a.price - b.price);
}

export function selectMonthlyPivotTarget(
  pivots: MissedMonthlyPivot[],
  currentPrice: number,
): MonthlyPivotScan {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { target: null, countAbovePrice: 0, pivotsAbovePrice: [] };
  }

  const pivotsAbovePrice = pivots
    .filter((pivot) => pivot.price > currentPrice)
    .sort((a, b) => a.price - b.price);

  return {
    target: pivotsAbovePrice[0] ?? null,
    countAbovePrice: pivotsAbovePrice.length,
    pivotsAbovePrice,
  };
}

export function findMissedMonthlyPivotsFromDailyBars(
  bars: Bar[],
  currentPrice: number,
  throughEtDate: string,
): MonthlyPivotScan {
  return selectMonthlyPivotTarget(
    findAllMissedMonthlyPivotsFromDailyBars(bars, throughEtDate),
    currentPrice,
  );
}

export async function scanAllMissedMonthlyPivots(
  ticker: string,
  throughEtDate: string,
  options: { lookbackMonths?: number } = {},
): Promise<MissedMonthlyPivot[]> {
  const lookbackMonths = options.lookbackMonths ?? DEFAULT_MONTHLY_PIVOT_LOOKBACK_MONTHS;
  const { year, month, day } = parseEtDateIso(throughEtDate);
  const start = addMonths(year, month, -lookbackMonths);
  const fromMs = nyClockToUtcMs(start.year, start.month, 1, 0, 0);
  const toMs = nyClockToUtcMs(year, month, day, 23, 59);
  const bars = await fetchBars({
    ticker,
    fromMs,
    toMs,
    resolution: "1d",
    extendedHours: false,
  });

  return findAllMissedMonthlyPivotsFromDailyBars(bars, throughEtDate);
}

export async function scanMissedMonthlyPivots(
  ticker: string,
  currentPrice: number,
  throughEtDate: string,
  options: { lookbackMonths?: number } = {},
): Promise<MonthlyPivotScan> {
  const pivots = await scanAllMissedMonthlyPivots(ticker, throughEtDate, options);
  return selectMonthlyPivotTarget(pivots, currentPrice);
}

export async function enrichHitsWithMonthlyPivots<T extends { ticker: string; priceNow: number }>(
  hits: T[],
  throughEtDate: string,
  options: { batchSize?: number; lookbackMonths?: number } = {},
): Promise<Array<T & MonthlyPivotEnrichment>> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const unique = new Map<string, { ticker: string; priceNow: number }>();

  for (const hit of hits) {
    if (!unique.has(hit.ticker)) {
      unique.set(hit.ticker, { ticker: hit.ticker, priceNow: hit.priceNow });
    }
  }

  const scans = new Map<string, MonthlyPivotEnrichment>();
  const tickers = [...unique.values()];

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const batchScans = await Promise.all(
      batch.map(async (row): Promise<[string, MonthlyPivotEnrichment]> => {
        try {
          const pivots = await scanAllMissedMonthlyPivots(row.ticker, throughEtDate, {
            lookbackMonths: options.lookbackMonths,
          });
          const scan = selectMonthlyPivotTarget(pivots, row.priceNow);
          return [
            row.ticker,
            {
              monthlyPivotTarget: scan.target,
              monthlyPivotCount: scan.countAbovePrice,
              monthlyPivotError: null,
            },
          ];
        } catch (error) {
          return [
            row.ticker,
            {
              monthlyPivotTarget: null,
              monthlyPivotCount: 0,
              monthlyPivotError: error instanceof Error ? error.message : "Monthly pivot scan failed.",
            },
          ];
        }
      }),
    );

    for (const [ticker, scan] of batchScans) {
      scans.set(ticker, scan);
    }
  }

  return hits.map((hit) => ({
    ...hit,
    ...(scans.get(hit.ticker) ?? {
      monthlyPivotTarget: null,
      monthlyPivotCount: 0,
      monthlyPivotError: "Monthly pivot scan unavailable.",
    }),
  }));
}
