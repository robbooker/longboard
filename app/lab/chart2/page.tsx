import Link from "next/link";
import { fetchBarsForDay, type Resolution } from "@/lib/polygon/bars";
import {
  rossCameronMomentum,
  rvolLookbackForResolution,
} from "@/lib/indicators";
import { computeSessionBoundaries } from "@/lib/time/sessionBoundaries";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";
import { fetchTopGainers } from "@/lib/gainers/topGainers";
import type { PolygonTickerSnapshot } from "@/types/polygon";
import AutoRefresh from "./AutoRefresh";
import ChartView from "../chart/ChartView";
import "../chart/chart.css";

export const dynamic = "force-dynamic";

const FALLBACK_TICKER = "NVDA";
const SPARSE_BAR_THRESHOLD = 50;
const RESOLUTIONS: readonly Resolution[] = ["1m", "5m"] as const;
const DEFAULT_RESOLUTION: Resolution = "1m";

const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,5}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type LiveMoversResult =
  | { ok: true; tickers: PolygonTickerSnapshot[]; fetchedAt: string; mode: string }
  | { ok: false; message: string };

function formatEtTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

function formatFetchedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function formatPrice(v: number | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "-";
  return `$${v.toFixed(v < 10 ? 2 : 2)}`;
}

function formatPct(v: number | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function formatVolume(v: number | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "-";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

function sanitizeTicker(input: string | undefined): string | null {
  if (!input) return null;
  const upper = input.toUpperCase().trim();
  return TICKER_PATTERN.test(upper) ? upper : null;
}

function sanitizeDate(input: string | undefined): string | null {
  if (!input) return null;
  return DATE_PATTERN.test(input) ? input : null;
}

function sanitizeResolution(input: string | undefined): Resolution | null {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  return (RESOLUTIONS as readonly string[]).includes(lower)
    ? (lower as Resolution)
    : null;
}

function stringParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function buildChartHref(
  ticker: string,
  etDate: string,
  resolution: Resolution,
): string {
  const params = new URLSearchParams({ ticker, date: etDate });
  if (resolution !== DEFAULT_RESOLUTION) params.set("res", resolution);
  return `/lab/chart2?${params.toString()}`;
}

async function loadLiveMovers(): Promise<LiveMoversResult> {
  try {
    const data = await fetchTopGainers({ limit: 10 });
    return {
      ok: true,
      tickers: data.tickers,
      fetchedAt: data.fetchedAt,
      mode: data.mode ?? "market",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

export default async function LabChart2Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const tickerParam = sanitizeTicker(stringParam(params.ticker));
  const dateParam = sanitizeDate(stringParam(params.date));
  const resolution = sanitizeResolution(stringParam(params.res)) ?? DEFAULT_RESOLUTION;

  const moversResult = await loadLiveMovers();
  const movers = moversResult.ok ? moversResult.tickers : [];
  const defaultMover = movers[0];

  const ticker = tickerParam ?? defaultMover?.ticker ?? FALLBACK_TICKER;
  const etDate = dateParam ?? mostRecentTradingDay();

  let bars: Awaited<ReturnType<typeof fetchBarsForDay>> = [];
  let barsError: string | null = null;
  try {
    bars = await fetchBarsForDay(ticker, etDate, resolution);
  } catch (err) {
    barsError = err instanceof Error ? err.message : String(err);
  }

  const indicator =
    bars.length > 0
      ? rossCameronMomentum(bars, {
          rvolLookback: rvolLookbackForResolution(resolution),
        })
      : null;
  const sessions = computeSessionBoundaries(etDate);
  const window =
    bars.length > 0
      ? `${formatEtTime(bars[0].time)}-${formatEtTime(bars[bars.length - 1].time)} ET`
      : "-";

  return (
    <div className="lab-chart-page">
      <AutoRefresh />
      <LiveMoversStyles />
      <div className="lab-chart-shell">
        <Header
          ticker={ticker}
          etDate={etDate}
          bars={bars.length}
          window={window}
          resolution={resolution}
          moversResult={moversResult}
        />
        <div className="lab-chart-body">
          <div className="lab-chart-canvas">
            <div className="lab-chart-canvas__inner">
              {bars.length > 0 && indicator ? (
                <>
                  {bars.length < SPARSE_BAR_THRESHOLD && (
                    <SparseTapeNotice resolution={resolution} />
                  )}
                  <ChartView
                    bars={bars}
                    indicator={indicator}
                    sessions={sessions}
                  />
                </>
              ) : (
                <ChartEmpty
                  ticker={ticker}
                  etDate={etDate}
                  resolution={resolution}
                  message={barsError}
                />
              )}
            </div>
          </div>
          <SidePanel
            moversResult={moversResult}
            currentTicker={ticker}
            etDate={etDate}
            resolution={resolution}
          />
        </div>
      </div>
    </div>
  );
}

function Header({
  ticker,
  etDate,
  bars,
  window,
  resolution,
  moversResult,
}: {
  ticker: string;
  etDate: string;
  bars: number;
  window: string;
  resolution: Resolution;
  moversResult: LiveMoversResult;
}) {
  const asOf = moversResult.ok ? `${formatFetchedAt(moversResult.fetchedAt)} ET` : "-";
  const mode = moversResult.ok ? moversResult.mode : "unavailable";

  return (
    <>
      <header className="lab-chart-header">
        <div className="lab-chart-header__title">
          <div className="lab-chart-eyebrow">Massive / Polygon Live</div>
          <h1 className="lab-chart-headline__title">
            {ticker}
            <span className="lab-chart-headline__sep">/</span>
            {etDate}
          </h1>
        </div>
        <div className="lab-chart-summary">
          <ResolutionToggle
            ticker={ticker}
            etDate={etDate}
            resolution={resolution}
          />
          <SummaryPill label="BARS" value={String(bars)} />
          <SummaryPill label="WINDOW" value={window} />
          <SummaryPill label="MODE" value={mode} />
          <SummaryPill label="AS OF" value={asOf} />
        </div>
      </header>
      <hr className="lab-chart-divider" />
    </>
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

function ResolutionToggle({
  ticker,
  etDate,
  resolution,
}: {
  ticker: string;
  etDate: string;
  resolution: Resolution;
}) {
  return (
    <div
      className="lab-chart-res-toggle"
      role="group"
      aria-label="Bar resolution"
    >
      <span className="lab-chart-res-toggle__label">RES</span>
      <div className="lab-chart-res-toggle__group">
        {RESOLUTIONS.map((r) => {
          const active = r === resolution;
          return (
            <Link
              key={r}
              href={buildChartHref(ticker, etDate, r)}
              prefetch={false}
              aria-pressed={active}
              className={
                "lab-chart-res-toggle__btn" +
                (active ? " lab-chart-res-toggle__btn--active" : "")
              }
            >
              {r}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function SparseTapeNotice({ resolution }: { resolution: Resolution }) {
  return (
    <div className="lab-chart-sparse-notice">
      Sparse {resolution} tape - indicator results may be unreliable.
    </div>
  );
}

function ChartEmpty({
  ticker,
  etDate,
  resolution,
  message,
}: {
  ticker: string;
  etDate: string;
  resolution: Resolution;
  message: string | null;
}) {
  return (
    <div className="lab-chart-empty">
      <div className="lab-chart-empty__title">No {resolution} data</div>
      <div className="lab-chart-empty__meta">
        {ticker} / {etDate}
      </div>
      <p className="lab-chart-empty__lede">
        Polygon returned no {resolution} bars for this ticker on this trading
        day. Use a ticker from the live movers list, or add a ticker/date in
        the URL.
      </p>
      {message && <pre className="lab-chart-empty__detail">{message}</pre>}
    </div>
  );
}

function SidePanel({
  moversResult,
  currentTicker,
  etDate,
  resolution,
}: {
  moversResult: LiveMoversResult;
  currentTicker: string;
  etDate: string;
  resolution: Resolution;
}) {
  return (
    <aside className="lab-chart-side">
      <div className="lab-chart-side__section-eyebrow">Live Movers</div>
      {moversResult.ok ? (
        <LiveMoversList
          tickers={moversResult.tickers}
          activeTicker={currentTicker}
          etDate={etDate}
          resolution={resolution}
        />
      ) : (
        <div className="lab-chart-watchlist__error">
          <div className="lab-chart-watchlist__error-title">
            Live movers unavailable
          </div>
          <pre className="lab-chart-watchlist__error-message">
            {moversResult.message}
          </pre>
        </div>
      )}
    </aside>
  );
}

function LiveMoversList({
  tickers,
  activeTicker,
  etDate,
  resolution,
}: {
  tickers: PolygonTickerSnapshot[];
  activeTicker: string;
  etDate: string;
  resolution: Resolution;
}) {
  if (tickers.length === 0) {
    return (
      <p className="lab-chart-watchlist__empty">
        No live movers matched the current small-cap filter.
      </p>
    );
  }

  return (
    <div className="lab-chart2-movers">
      <div className="lab-chart2-movers__head">
        <span>Symbol</span>
        <span>Price</span>
        <span>% Gain</span>
        <span>Vol</span>
      </div>
      <ol className="lab-chart2-movers__list">
      {tickers.map((t) => {
        const active = t.ticker === activeTicker;
        return (
          <li
            key={t.ticker}
            className={
              "lab-chart-watchlist__item" +
              (active ? " lab-chart-watchlist__item--active" : "")
            }
          >
            <Link
              href={buildChartHref(t.ticker, etDate, resolution)}
              prefetch={false}
              className="lab-chart2-movers__link"
            >
              <span className="lab-chart-watchlist__ticker">{t.ticker}</span>
              <span className="lab-chart-watchlist__price">
                {formatPrice(t.day?.c)}
              </span>
              <span className="lab-chart-watchlist__pct">
                {formatPct(t.todaysChangePerc)}
              </span>
              <span className="lab-chart-watchlist__price">
                {formatVolume(t.day?.v)}
              </span>
            </Link>
          </li>
        );
      })}
      </ol>
    </div>
  );
}

function LiveMoversStyles() {
  return (
    <style>
      {`
        .lab-chart-page .lab-chart2-movers {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .lab-chart-page .lab-chart2-movers__head,
        .lab-chart-page .lab-chart2-movers__link {
          display: grid;
          grid-template-columns: minmax(64px, 1fr) minmax(58px, auto) minmax(58px, auto) minmax(58px, auto);
          align-items: baseline;
          gap: 12px;
        }

        .lab-chart-page .lab-chart2-movers__head {
          padding: 0 10px 6px;
          border-bottom: 1px solid var(--lab-ink-30);
          font-family: var(--lab-mono);
          font-size: 10px;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          font-weight: 700;
          color: var(--lab-ink-55);
        }

        .lab-chart-page .lab-chart2-movers__head span:not(:first-child) {
          text-align: right;
        }

        .lab-chart-page .lab-chart2-movers__list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .lab-chart-page .lab-chart2-movers__link {
          padding: 8px 10px;
          text-decoration: none;
          color: inherit;
        }

        .lab-chart-page .lab-chart2-movers__link span:not(:first-child) {
          text-align: right;
        }
      `}
    </style>
  );
}
