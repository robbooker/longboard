import Link from "next/link";
import ChartView from "@/app/lab/chart/ChartView";
import "@/app/lab/chart/chart.css";
import AIIO from "@/data/chart-webinar/2026-05-12/AIIO.json";
import BZFD from "@/data/chart-webinar/2026-05-12/BZFD.json";
import CNCK from "@/data/chart-webinar/2026-05-12/CNCK.json";
import HLIT from "@/data/chart-webinar/2026-05-12/HLIT.json";
import HTCO from "@/data/chart-webinar/2026-05-12/HTCO.json";
import MGNX from "@/data/chart-webinar/2026-05-12/MGNX.json";
import PLUG from "@/data/chart-webinar/2026-05-12/PLUG.json";
import QUBT from "@/data/chart-webinar/2026-05-12/QUBT.json";
import TDIC from "@/data/chart-webinar/2026-05-12/TDIC.json";
import USBC from "@/data/chart-webinar/2026-05-12/USBC.json";
import WEN from "@/data/chart-webinar/2026-05-12/WEN.json";
import XOS from "@/data/chart-webinar/2026-05-12/XOS.json";
import gapEvents from "@/data/chart-webinar/2026-05-12/gap_events_2026_05_12.json";
import {
  rossCameronMomentum,
  rvolLookbackForResolution,
} from "@/lib/indicators";
import { nyClockToUtcMs, polygonGet } from "@/lib/polygon/client";
import type { Resolution } from "@/lib/polygon/bars";
import type { Bar } from "@/lib/polygon/types";
import { computeSessionBoundaries } from "@/lib/time/sessionBoundaries";

export const dynamic = "force-dynamic";

const DATA_DATE = "2026-05-12";
const DAILY_HISTORY_TARGET_BARS = 120;
const DAILY_HISTORY_LOOKBACK_DAYS = 220;
const DEFAULT_TIMEFRAME: WebinarTimeframe = "1m";
const TIMEFRAMES = ["1m", "5m", "1d"] as const;

type WebinarTimeframe = (typeof TIMEFRAMES)[number];

type Qualifier = {
  ticker: string;
  prior_close: number;
  premkt_last_0830: number;
  premkt_volume_0400_0830: number;
  gap_pct: number;
  tue_open: number;
  tue_high: number;
  tue_low: number;
  tue_close: number;
  tue_volume: number;
  type: string;
  name: string;
};

type GapEventsFile = {
  target_date: string;
  prior_date: string;
  count: number;
  qualifiers: Qualifier[];
};

type RawBar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
};

type SymbolBarsFile = {
  ticker: string;
  date: string;
  session: string;
  adjusted: boolean;
  bars: RawBar[];
};

type AggsResponse = {
  results?: RawBar[];
};

type SearchParams = Record<string, string | string[] | undefined>;

const SYMBOL_BARS: Record<string, SymbolBarsFile> = {
  AIIO,
  BZFD,
  CNCK,
  HLIT,
  HTCO,
  MGNX,
  PLUG,
  QUBT,
  TDIC,
  USBC,
  WEN,
  XOS,
} as Record<string, SymbolBarsFile>;

function stringParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sanitizeTicker(input: string | undefined): string | null {
  if (!input) return null;
  const upper = input.toUpperCase().trim();
  return /^[A-Z][A-Z0-9.]{0,5}$/.test(upper) ? upper : null;
}

function sanitizeTimeframe(input: string | undefined): WebinarTimeframe {
  if (!input) return DEFAULT_TIMEFRAME;
  const lower = input.toLowerCase().trim();
  return (TIMEFRAMES as readonly string[]).includes(lower)
    ? (lower as WebinarTimeframe)
    : DEFAULT_TIMEFRAME;
}

function loadGapEvents(): GapEventsFile {
  const file = gapEvents as GapEventsFile;
  return {
    ...file,
    qualifiers: [...file.qualifiers].sort((a, b) => b.gap_pct - a.gap_pct),
  };
}

function loadSymbolBars(ticker: string): Bar[] {
  const file = SYMBOL_BARS[ticker];
  if (!file) return [];

  return file.bars
    .map((bar) => ({
      time: Math.floor(bar.t / 1000),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: typeof bar.v === "number" ? bar.v : 0,
    }))
    .sort((a, b) => a.time - b.time);
}

function aggregateFiveMinuteBars(bars: Bar[]): Bar[] {
  const result: Bar[] = [];
  let current: Bar | null = null;

  for (const bar of bars) {
    const bucket = Math.floor(bar.time / 300) * 300;
    if (!current || current.time !== bucket) {
      if (current) result.push(current);
      current = { ...bar, time: bucket };
      continue;
    }

    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  }

  if (current) result.push(current);
  return result;
}

function etCloseSeconds(dateIso: string): number {
  const [year, month, day] = dateIso.split("-").map(Number);
  return Math.floor(nyClockToUtcMs(year, month, day, 16, 0) / 1000);
}

function addUtcDays(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dailyContextBars(event: Qualifier, priorDate: string, targetDate: string): Bar[] {
  return [
    {
      time: etCloseSeconds(priorDate),
      open: event.prior_close,
      high: event.prior_close,
      low: event.prior_close,
      close: event.prior_close,
      volume: 0,
    },
    {
      time: etCloseSeconds(targetDate),
      open: event.tue_open,
      high: event.tue_high,
      low: event.tue_low,
      close: event.tue_close,
      volume: event.tue_volume,
    },
  ];
}

function normalizeDailyAggs(rows: RawBar[]): Bar[] {
  return rows
    .filter(
      (bar) =>
        typeof bar.t === "number" &&
        typeof bar.o === "number" &&
        typeof bar.h === "number" &&
        typeof bar.l === "number" &&
        typeof bar.c === "number",
    )
    .map((bar) => {
      const dateIso = new Date(bar.t).toISOString().slice(0, 10);
      return {
        time: etCloseSeconds(dateIso),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: typeof bar.v === "number" ? bar.v : 0,
      };
    })
    .sort((a, b) => a.time - b.time);
}

async function loadDailyHistoryBars(
  event: Qualifier,
  priorDate: string,
  targetDate: string,
): Promise<Bar[]> {
  try {
    const from = addUtcDays(targetDate, -DAILY_HISTORY_LOOKBACK_DAYS);
    const data = await polygonGet<AggsResponse>(
      `/v2/aggs/ticker/${encodeURIComponent(
        event.ticker,
      )}/range/1/day/${from}/${targetDate}?adjusted=true&sort=asc&limit=50000`,
    );
    const bars = normalizeDailyAggs(data.results ?? []);
    if (bars.length >= 100) return bars.slice(-DAILY_HISTORY_TARGET_BARS);
    if (bars.length > 2) return bars;
  } catch {
    // Local replay still works without Polygon credentials in dev or preview.
  }

  return dailyContextBars(event, priorDate, targetDate);
}

async function barsForTimeframe(
  timeframe: WebinarTimeframe,
  oneMinuteBars: Bar[],
  event: Qualifier,
  priorDate: string,
  targetDate: string,
): Promise<Bar[]> {
  if (timeframe === "5m") return aggregateFiveMinuteBars(oneMinuteBars);
  if (timeframe === "1d") {
    return loadDailyHistoryBars(event, priorDate, targetDate);
  }
  return oneMinuteBars;
}

function buildHref(ticker: string, timeframe: WebinarTimeframe): string {
  const params = new URLSearchParams({ ticker });
  if (timeframe !== DEFAULT_TIMEFRAME) params.set("tf", timeframe);
  return `/lab/chart-webinar?${params.toString()}`;
}

function formatPrice(value: number): string {
  return `$${value.toFixed(value < 10 ? 2 : 2)}`;
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatVolume(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatEtTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

function formatEtDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(unixSeconds * 1000));
}

function formatWindow(bars: Bar[], timeframe: WebinarTimeframe): string {
  if (bars.length === 0) return "-";
  if (timeframe === "1d") {
    return `${formatEtDate(bars[0].time)} - ${formatEtDate(bars[bars.length - 1].time)}`;
  }
  return `${formatEtTime(bars[0].time)}-${formatEtTime(bars[bars.length - 1].time)} ET`;
}

function timeframeLabel(timeframe: WebinarTimeframe): string {
  if (timeframe === "1d") return "Daily";
  return timeframe;
}

export default async function ChartWebinarPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const events = loadGapEvents();
  const requestedTicker = sanitizeTicker(stringParam(params.ticker));
  const timeframe = sanitizeTimeframe(stringParam(params.tf));
  const defaultEvent = events.qualifiers[0];
  const selected =
    events.qualifiers.find((event) => event.ticker === requestedTicker) ??
    defaultEvent;

  const oneMinuteBars = loadSymbolBars(selected.ticker);
  const bars = await barsForTimeframe(
    timeframe,
    oneMinuteBars,
    selected,
    events.prior_date,
    events.target_date,
  );
  const indicator =
    timeframe === "1d"
      ? rossCameronMomentum(bars)
      : rossCameronMomentum(bars, {
          rvolLookback: rvolLookbackForResolution(timeframe as Resolution),
        });
  const sessions =
    timeframe === "1d"
      ? {
          pmStart: bars[0]?.time ?? etCloseSeconds(events.prior_date),
          rthStart: bars[0]?.time ?? etCloseSeconds(events.prior_date),
          rthEnd: bars[bars.length - 1]?.time ?? etCloseSeconds(events.target_date),
          ahEnd: bars[bars.length - 1]?.time ?? etCloseSeconds(events.target_date),
        }
      : computeSessionBoundaries(events.target_date);
  const window = formatWindow(bars, timeframe);
  const dataSourceLabel =
    timeframe === "1d" && bars.length > 2
      ? "Polygon daily history"
      : "local replay data";
  const highFromPriorClose =
    ((selected.tue_high - selected.prior_close) / selected.prior_close) * 100;

  return (
    <div className="lab-chart-page chart-webinar-page">
      <style>{chartWebinarStyles}</style>
      <div className="lab-chart-shell">
        <header className="lab-chart-header chart-webinar-header">
          <div className="lab-chart-header__title">
            <div className="lab-chart-eyebrow">Longboard Lab / Webinar</div>
            <h1 className="lab-chart-headline__title">
              {selected.ticker}
              <span className="lab-chart-headline__sep">/</span>
              May 12 Runners
            </h1>
          </div>
          <div className="lab-chart-summary">
            <TimeframeToggle
              ticker={selected.ticker}
              timeframe={timeframe}
            />
            <SummaryPill label="BARS" value={String(bars.length)} />
            <SummaryPill label="WINDOW" value={window} />
            <SummaryPill label="RUNNERS" value={String(events.count)} />
          </div>
        </header>
        <hr className="lab-chart-divider" />

        <div className="chart-webinar-context">
          <Metric label="Gap" value={formatPct(selected.gap_pct)} />
          <Metric label="Premkt Vol" value={formatVolume(selected.premkt_volume_0400_0830)} />
          <Metric label="Day High" value={formatPrice(selected.tue_high)} />
          <Metric label="High Vs Prior" value={formatPct(highFromPriorClose)} />
          <Metric label="Day Vol" value={formatVolume(selected.tue_volume)} />
        </div>

        <div className="lab-chart-body chart-webinar-body">
          <main className="chart-webinar-main">
            <div className="chart-webinar-symbol-row">
              <div>
                <div className="chart-webinar-company">{selected.name}</div>
                <div className="chart-webinar-submeta">
                  {events.target_date} / {timeframeLabel(timeframe)} / {dataSourceLabel}
                </div>
              </div>
              <div className="chart-webinar-price-strip">
                <span>Prior {formatPrice(selected.prior_close)}</span>
                <span>Open {formatPrice(selected.tue_open)}</span>
                <span>Close {formatPrice(selected.tue_close)}</span>
              </div>
            </div>
            <div className="lab-chart-canvas chart-webinar-canvas">
              <div className="lab-chart-canvas__inner">
                {bars.length > 0 ? (
                  <ChartView
                    key={`${selected.ticker}-${timeframe}`}
                    bars={bars}
                    indicator={indicator}
                    sessions={sessions}
                    resolution={timeframe}
                  />
                ) : (
                  <div className="lab-chart-empty">
                    <div className="lab-chart-empty__title">No chart data</div>
                    <div className="lab-chart-empty__meta">{selected.ticker}</div>
                    <p className="lab-chart-empty__lede">
                      The local webinar bundle did not include bars for this symbol.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </main>

          <aside className="lab-chart-side chart-webinar-side">
            <div>
              <div className="lab-chart-side__section-eyebrow">Stock List</div>
              <h2 className="lab-chart-side__heading">May 12 qualifiers</h2>
              <p className="lab-chart-side__lede">
                Click a ticker to load the same timeframe in the chart.
              </p>
            </div>
            <RunnerList
              events={events.qualifiers}
              activeTicker={selected.ticker}
              timeframe={timeframe}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}

function TimeframeToggle({
  ticker,
  timeframe,
}: {
  ticker: string;
  timeframe: WebinarTimeframe;
}) {
  return (
    <div
      className="lab-chart-res-toggle"
      role="group"
      aria-label="Chart timeframe"
    >
      <span className="lab-chart-res-toggle__label">TF</span>
      <div className="lab-chart-res-toggle__group">
        {TIMEFRAMES.map((nextTimeframe) => (
          <Link
            key={nextTimeframe}
            href={buildHref(ticker, nextTimeframe)}
            prefetch={false}
            aria-pressed={timeframe === nextTimeframe}
            className={
              "lab-chart-res-toggle__btn" +
              (timeframe === nextTimeframe
                ? " lab-chart-res-toggle__btn--active"
                : "")
            }
          >
            {timeframeLabel(nextTimeframe)}
          </Link>
        ))}
      </div>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="lab-chart-summary__pill">
      <span className="lab-chart-summary__pill-label">{label}</span>
      {value}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="chart-webinar-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RunnerList({
  events,
  activeTicker,
  timeframe,
}: {
  events: Qualifier[];
  activeTicker: string;
  timeframe: WebinarTimeframe;
}) {
  return (
    <ol className="chart-webinar-runner-list">
      {events.map((event, index) => {
        const active = event.ticker === activeTicker;
        return (
          <li
            key={event.ticker}
            className={
              "chart-webinar-runner" +
              (active ? " chart-webinar-runner--active" : "")
            }
          >
            <Link href={buildHref(event.ticker, timeframe)} prefetch={false}>
              <span className="chart-webinar-runner__rank">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{event.ticker}</strong>
                <small>{event.name}</small>
              </span>
              <span className="chart-webinar-runner__stats">
                <b>{formatPct(event.gap_pct)}</b>
                <small>{formatVolume(event.tue_volume)}</small>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

const chartWebinarStyles = `
  .chart-webinar-page .lab-chart-shell {
    max-width: 1560px;
  }

  .chart-webinar-header {
    align-items: flex-end;
  }

  .chart-webinar-context {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
    margin: 0 0 16px;
  }

  .chart-webinar-metric {
    min-width: 0;
    border: 1px solid var(--lab-ink-30);
    background: var(--lab-card);
    border-radius: 8px;
    padding: 12px 14px;
  }

  .chart-webinar-metric span,
  .chart-webinar-submeta,
  .chart-webinar-price-strip,
  .chart-webinar-runner small,
  .chart-webinar-runner__stats {
    font-family: var(--lab-mono);
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--lab-ink-55);
  }

  .chart-webinar-metric strong {
    display: block;
    margin-top: 6px;
    font-size: 22px;
    line-height: 1;
    letter-spacing: 0;
    color: var(--lab-ink);
    font-variant-numeric: tabular-nums;
  }

  .chart-webinar-body {
    grid-template-columns: minmax(0, 1fr) 390px;
  }

  .chart-webinar-main {
    min-width: 0;
  }

  .chart-webinar-symbol-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 10px;
  }

  .chart-webinar-company {
    max-width: 720px;
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0;
    color: var(--lab-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chart-webinar-submeta {
    margin-top: 4px;
  }

  .chart-webinar-price-strip {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .chart-webinar-price-strip span {
    border: 1px solid var(--lab-ink-30);
    background: var(--lab-card-2);
    border-radius: 999px;
    padding: 6px 9px;
  }

  .chart-webinar-canvas {
    height: 620px;
    border-radius: 8px;
  }

  .chart-webinar-side {
    max-height: 684px;
    border-radius: 8px;
    gap: 16px;
  }

  .chart-webinar-runner-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .chart-webinar-runner {
    border-left: 3px solid transparent;
    border-radius: 5px;
  }

  .chart-webinar-runner:hover,
  .chart-webinar-runner--active {
    background: var(--lab-card-2);
  }

  .chart-webinar-runner--active {
    border-left-color: var(--lab-amber);
  }

  .chart-webinar-runner a {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 10px 9px;
    color: inherit;
    text-decoration: none;
  }

  .chart-webinar-runner__rank {
    font-family: var(--lab-sans);
    font-size: 17px;
    font-weight: 900;
    letter-spacing: -0.8px;
    color: var(--lab-gold);
    font-variant-numeric: tabular-nums;
  }

  .chart-webinar-runner strong {
    display: block;
    font-size: 16px;
    line-height: 1;
    color: var(--lab-ink);
  }

  .chart-webinar-runner small {
    display: block;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: none;
    letter-spacing: 0;
  }

  .chart-webinar-runner__stats {
    text-align: right;
  }

  .chart-webinar-runner__stats b {
    display: block;
    color: var(--lab-gold);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .chart-webinar-runner__stats small {
    margin-top: 4px;
    white-space: nowrap;
  }

  @media (max-width: 1100px) {
    .chart-webinar-context {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .chart-webinar-body {
      grid-template-columns: 1fr;
    }

    .chart-webinar-side {
      max-height: none;
    }
  }

  @media (max-width: 760px) {
    .chart-webinar-context {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .chart-webinar-symbol-row {
      align-items: flex-start;
      flex-direction: column;
    }

    .chart-webinar-price-strip {
      justify-content: flex-start;
    }

    .chart-webinar-company {
      white-space: normal;
    }

    .chart-webinar-canvas {
      height: 430px;
    }
  }
`;
