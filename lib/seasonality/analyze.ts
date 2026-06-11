export const SEASONALITY_WINDOWS = [2, 5, 10] as const;

export type SeasonalityWindow = (typeof SEASONALITY_WINDOWS)[number];

export type SeasonalityDailyBar = {
  date: string;
  year: number;
  month: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
};

export type SeasonalityPathPoint = {
  index: number;
  averageReturnPct: number;
  observations: number;
};

export type SeasonalityMonthStat = {
  month: number;
  averageReturnPct: number | null;
  winRatePct: number | null;
  observations: number;
};

export type SeasonalityWindowAnalysis = {
  years: SeasonalityWindow;
  from: string;
  to: string;
  observedYears: number[];
  barCount: number;
  averagePath: SeasonalityPathPoint[];
  monthly: SeasonalityMonthStat[];
};

export type SeasonalityAnalysis = {
  ticker: string;
  asOf: string;
  latestClose: number;
  barsFetched: number;
  windows: SeasonalityWindowAnalysis[];
};

type PolygonAgg = {
  t?: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
};

type PolygonAggsResponse = {
  results?: PolygonAgg[];
};

const POLYGON_BASE = "https://api.polygon.io";
const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startForWindow(asOf: string, years: SeasonalityWindow): string {
  const { year } = parseIsoDate(asOf);
  return `${year - years + 1}-01-01`;
}

function etDateFromMs(ms: number): string {
  return ET_DATE_FMT.format(new Date(ms));
}

function toDailyBars(results: PolygonAgg[]): SeasonalityDailyBar[] {
  const bars: SeasonalityDailyBar[] = [];

  for (const result of results) {
    if (
      typeof result.t !== "number" ||
      typeof result.o !== "number" ||
      typeof result.h !== "number" ||
      typeof result.l !== "number" ||
      typeof result.c !== "number"
    ) {
      continue;
    }

    const date = etDateFromMs(result.t);
    const { year, month } = parseIsoDate(date);
    bars.push({
      date,
      year,
      month,
      open: result.o,
      high: result.h,
      low: result.l,
      close: result.c,
      volume: typeof result.v === "number" ? result.v : 0,
    });
  }

  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchSeasonalityDailyBars(
  ticker: string,
  now = new Date(),
): Promise<SeasonalityDailyBar[]> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("POLYGON_API_KEY not configured");

  const to = formatIsoDate(now);
  const from = `${now.getUTCFullYear() - 10}-01-01`;
  const path = `/v2/aggs/ticker/${encodeURIComponent(
    ticker,
  )}/range/1/day/${from}/${to}`;
  const url = new URL(path, POLYGON_BASE);
  url.searchParams.set("adjusted", "true");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", "50000");
  url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url, { next: { revalidate: 60 * 60 * 12 } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Polygon ${ticker} daily bars returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as PolygonAggsResponse;
  return toDailyBars(data.results ?? []);
}

function groupBarsByYear(bars: SeasonalityDailyBar[]): Map<number, SeasonalityDailyBar[]> {
  const groups = new Map<number, SeasonalityDailyBar[]>();
  for (const bar of bars) {
    const existing = groups.get(bar.year);
    if (existing) {
      existing.push(bar);
    } else {
      groups.set(bar.year, [bar]);
    }
  }
  return groups;
}

function buildAveragePath(bars: SeasonalityDailyBar[]): SeasonalityPathPoint[] {
  const yearly = groupBarsByYear(bars);
  const buckets = new Map<number, number[]>();

  for (const yearBars of yearly.values()) {
    const baseline = yearBars[0]?.close;
    if (!baseline || baseline <= 0) continue;

    yearBars.forEach((bar, index) => {
      const value = ((bar.close / baseline) - 1) * 100;
      const existing = buckets.get(index);
      if (existing) {
        existing.push(value);
      } else {
        buckets.set(index, [value]);
      }
    });
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([index, values]) => ({
      index,
      averageReturnPct: values.reduce((sum, value) => sum + value, 0) / values.length,
      observations: values.length,
    }));
}

function buildMonthlyStats(
  bars: SeasonalityDailyBar[],
  asOf: string,
): SeasonalityMonthStat[] {
  const buckets = new Map<number, number[]>();
  const asOfParts = parseIsoDate(asOf);

  let currentKey: string | null = null;
  let currentMonth = 0;
  let startPrice = 0;
  let lastBar: SeasonalityDailyBar | null = null;
  let previousBar: SeasonalityDailyBar | null = null;

  function finalize() {
    if (!lastBar || !currentKey || !startPrice) return;
    const isCurrentOpenMonth =
      lastBar.year === asOfParts.year && lastBar.month === asOfParts.month;
    if (isCurrentOpenMonth) return;

    const value = ((lastBar.close / startPrice) - 1) * 100;
    const existing = buckets.get(currentMonth);
    if (existing) {
      existing.push(value);
    } else {
      buckets.set(currentMonth, [value]);
    }
  }

  for (const bar of bars) {
    const key = `${bar.year}-${bar.month}`;
    if (key !== currentKey) {
      finalize();
      currentKey = key;
      currentMonth = bar.month;
      startPrice = previousBar?.close ?? bar.open;
    }
    lastBar = bar;
    previousBar = bar;
  }
  finalize();

  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const values = buckets.get(month) ?? [];
    if (values.length === 0) {
      return {
        month,
        averageReturnPct: null,
        winRatePct: null,
        observations: 0,
      };
    }

    return {
      month,
      averageReturnPct: values.reduce((sum, value) => sum + value, 0) / values.length,
      winRatePct: (values.filter((value) => value > 0).length / values.length) * 100,
      observations: values.length,
    };
  });
}

export function analyzeSeasonality(
  ticker: string,
  bars: SeasonalityDailyBar[],
): SeasonalityAnalysis {
  if (bars.length === 0) {
    throw new Error(`No daily bars returned for ${ticker}`);
  }

  const asOf = bars[bars.length - 1].date;
  const latestClose = bars[bars.length - 1].close;

  return {
    ticker,
    asOf,
    latestClose,
    barsFetched: bars.length,
    windows: SEASONALITY_WINDOWS.map((years) => {
      const from = startForWindow(asOf, years);
      const windowBars = bars.filter((bar) => bar.date >= from && bar.date <= asOf);
      return {
        years,
        from,
        to: asOf,
        observedYears: Array.from(new Set(windowBars.map((bar) => bar.year))).sort(),
        barCount: windowBars.length,
        averagePath: buildAveragePath(windowBars),
        monthly: buildMonthlyStats(windowBars, asOf),
      };
    }),
  };
}

export async function loadSeasonalityAnalysis(ticker: string): Promise<SeasonalityAnalysis> {
  const bars = await fetchSeasonalityDailyBars(ticker);
  return analyzeSeasonality(ticker, bars);
}
