import Link from "next/link";
import { fetchBarsForDay, type Resolution } from "@/lib/polygon/bars";
import { computeSessionBoundaries } from "@/lib/time/sessionBoundaries";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";
import { fetchTopGainers } from "@/lib/gainers/topGainers";
import type { PolygonTickerSnapshot } from "@/types/polygon";
import AutoRefresh from "./AutoRefresh";
import BackfilledChart from "../chart/BackfilledChart";
import "../chart/chart.css";

export const dynamic = "force-dynamic";

const FALLBACK_TICKER = "NVDA";
const FALLBACK_TICKERS = ["NVDA", "TSLA", "AMD", "AAPL"] as const;
const SPARSE_BAR_THRESHOLD = 50;
const RESOLUTIONS: readonly Resolution[] = ["1m", "5m"] as const;
const DEFAULT_RESOLUTION: Resolution = "1m";
const CHART_SLOTS = ["c1", "c2", "c3", "c4"] as const;

const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,5}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type LiveMoversResult =
  | { ok: true; tickers: PolygonTickerSnapshot[]; fetchedAt: string; mode: string }
  | { ok: false; message: string };

type ChartSlot = (typeof CHART_SLOTS)[number];

type ChartPayload = {
  slot: ChartSlot;
  ticker: string;
  bars: Awaited<ReturnType<typeof fetchBarsForDay>>;
  barsError: string | null;
  sessions: ReturnType<typeof computeSessionBoundaries>;
  window: string;
};

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
  tickers: readonly string[],
  etDate: string,
  resolution: Resolution,
  updates: Partial<Record<ChartSlot, string>> = {},
): string {
  const params = new URLSearchParams({ date: etDate });
  if (resolution !== DEFAULT_RESOLUTION) params.set("res", resolution);
  CHART_SLOTS.forEach((slot, index) => {
    params.set(slot, updates[slot] ?? tickers[index] ?? FALLBACK_TICKER);
  });
  return `/lab/chart2?${params.toString()}`;
}

function uniqueTickerDefaults(
  explicitTickers: (string | null)[],
  moverTickers: string[],
): string[] {
  const next: string[] = [];
  for (const ticker of [
    ...explicitTickers,
    ...moverTickers,
    ...FALLBACK_TICKERS,
  ]) {
    if (!ticker || next.includes(ticker)) continue;
    next.push(ticker);
    if (next.length === CHART_SLOTS.length) break;
  }
  return next;
}

function hiddenFieldsForSlot({
  tickers,
  inputName,
  etDate,
  resolution,
}: {
  tickers: readonly string[];
  inputName: ChartSlot;
  etDate: string;
  resolution: Resolution;
}) {
  const fields = [{ name: "date", value: etDate }];
  if (resolution !== DEFAULT_RESOLUTION) {
    fields.push({ name: "res", value: resolution });
  }
  CHART_SLOTS.forEach((slot, index) => {
    if (slot !== inputName) {
      fields.push({ name: slot, value: tickers[index] ?? FALLBACK_TICKER });
    }
  });
  return fields;
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

  const explicitTickers = CHART_SLOTS.map((slot, index) => {
    const slotTicker = sanitizeTicker(stringParam(params[slot]));
    return index === 0 ? slotTicker ?? tickerParam : slotTicker;
  });
  const tickers = uniqueTickerDefaults(
    explicitTickers,
    movers.map((mover) => mover.ticker),
  );
  const etDate = dateParam ?? mostRecentTradingDay();
  const realtimeEnabled =
    resolution === "1m" && etDate === mostRecentTradingDay();

  const charts = await Promise.all(
    CHART_SLOTS.map(async (slot, index): Promise<ChartPayload> => {
      const ticker = tickers[index] ?? FALLBACK_TICKER;
      let bars: Awaited<ReturnType<typeof fetchBarsForDay>> = [];
      let barsError: string | null = null;
      try {
        bars = await fetchBarsForDay(ticker, etDate, resolution);
      } catch (err) {
        barsError = err instanceof Error ? err.message : String(err);
      }

      return {
        slot,
        ticker,
        bars,
        barsError,
        sessions: computeSessionBoundaries(etDate),
        window:
          bars.length > 0
            ? `${formatEtTime(bars[0].time)}-${formatEtTime(bars[bars.length - 1].time)} ET`
            : "-",
      };
    }),
  );

  return (
    <div className="lab-chart-page lab-chart-page--quad">
      <AutoRefresh />
      <LiveMoversStyles />
      <div className="lab-chart-shell">
        <Header
          etDate={etDate}
          bars={charts.reduce((total, chart) => total + chart.bars.length, 0)}
          tickers={tickers}
          resolution={resolution}
          moversResult={moversResult}
        />
        <div className="lab-chart-body">
          <div className="lab-chart-quad" aria-label="Quad chart view">
            {charts.map((chart) => (
              <ChartCard
                key={`${chart.slot}-${chart.ticker}-${etDate}-${resolution}`}
                chart={chart}
                tickers={tickers}
                etDate={etDate}
                resolution={resolution}
                realtimeEnabled={realtimeEnabled}
              />
            ))}
          </div>
          <SidePanel
            moversResult={moversResult}
            currentTickers={tickers}
            etDate={etDate}
            resolution={resolution}
          />
        </div>
      </div>
    </div>
  );
}

function Header({
  etDate,
  bars,
  tickers,
  resolution,
  moversResult,
}: {
  etDate: string;
  bars: number;
  tickers: readonly string[];
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
            Quad Charts
            <span className="lab-chart-headline__sep">/</span>
            {etDate}
          </h1>
        </div>
        <div className="lab-chart-summary">
          <ResolutionToggle
            tickers={tickers}
            etDate={etDate}
            resolution={resolution}
          />
          <SummaryPill label="BARS" value={String(bars)} />
          <SummaryPill label="MODE" value={mode} />
          <SummaryPill label="AS OF" value={asOf} />
        </div>
      </header>
      <hr className="lab-chart-divider" />
    </>
  );
}

function ChartCard({
  chart,
  tickers,
  etDate,
  resolution,
  realtimeEnabled,
}: {
  chart: ChartPayload;
  tickers: readonly string[];
  etDate: string;
  resolution: Resolution;
  realtimeEnabled: boolean;
}) {
  return (
    <section className="lab-chart-canvas" aria-label={`${chart.ticker} chart`}>
      <div className="lab-chart-canvas__inner">
        {chart.bars.length > 0 ? (
          <>
            {chart.bars.length < SPARSE_BAR_THRESHOLD && (
              <SparseTapeNotice resolution={resolution} />
            )}
            <BackfilledChart
              ticker={chart.ticker}
              initialDate={etDate}
              resolution={resolution}
              initialBars={chart.bars}
              initialSessions={chart.sessions}
              realtime={{ enabled: realtimeEnabled }}
              symbolControl={{
                inputName: chart.slot,
                hiddenFields: hiddenFieldsForSlot({
                  tickers,
                  inputName: chart.slot,
                  etDate,
                  resolution,
                }),
              }}
            />
          </>
        ) : (
          <>
            <StaticSymbolControl
              ticker={chart.ticker}
              inputName={chart.slot}
              hiddenFields={hiddenFieldsForSlot({
                tickers,
                inputName: chart.slot,
                etDate,
                resolution,
              })}
            />
            <ChartEmpty
              ticker={chart.ticker}
              etDate={etDate}
              resolution={resolution}
              message={chart.barsError}
            />
          </>
        )}
      </div>
    </section>
  );
}

function StaticSymbolControl({
  ticker,
  inputName,
  hiddenFields,
}: {
  ticker: string;
  inputName: ChartSlot;
  hiddenFields: { name: string; value: string }[];
}) {
  return (
    <details className="lab-chart-symbol-control lab-chart-symbol-control--static">
      <summary className="lab-chart-symbol-control__summary">
        <span className="lab-chart-symbol-control__ticker">{ticker}</span>
        <span className="lab-chart-symbol-control__status">NO DATA</span>
      </summary>
      <form className="lab-chart-symbol-control__form" action="/lab/chart2" method="get">
        {hiddenFields.map((field) => (
          <input
            key={`${field.name}-${field.value}`}
            type="hidden"
            name={field.name}
            value={field.value}
          />
        ))}
        <input
          className="lab-chart-symbol-control__input"
          name={inputName}
          defaultValue={ticker}
          maxLength={6}
          pattern="[A-Za-z][A-Za-z0-9.]{0,5}"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label={`Change ${ticker} chart symbol`}
        />
        <button className="lab-chart-symbol-control__button" type="submit">
          Load
        </button>
      </form>
    </details>
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
  tickers,
  etDate,
  resolution,
}: {
  tickers: readonly string[];
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
              href={buildChartHref(tickers, etDate, r)}
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
        day. Use the symbol box, live movers list, or add a ticker/date in the
        URL.
      </p>
      {message && <pre className="lab-chart-empty__detail">{message}</pre>}
    </div>
  );
}

function SidePanel({
  moversResult,
  currentTickers,
  etDate,
  resolution,
}: {
  moversResult: LiveMoversResult;
  currentTickers: readonly string[];
  etDate: string;
  resolution: Resolution;
}) {
  return (
    <aside className="lab-chart-side">
      <div className="lab-chart-side__section-eyebrow">Live Movers</div>
      {moversResult.ok ? (
        <LiveMoversList
          tickers={moversResult.tickers}
          activeTickers={currentTickers}
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
  activeTickers,
  etDate,
  resolution,
}: {
  tickers: PolygonTickerSnapshot[];
  activeTickers: readonly string[];
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
        const active = activeTickers.includes(t.ticker);
        return (
          <li
            key={t.ticker}
            className={
              "lab-chart-watchlist__item" +
              (active ? " lab-chart-watchlist__item--active" : "")
            }
          >
            <Link
              href={buildChartHref(activeTickers, etDate, resolution, {
                c1: t.ticker,
              })}
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

        .lab-chart-page .lab-chart-symbol-form {
          display: inline-flex;
          align-items: stretch;
          min-height: 36px;
          border: 1px solid var(--lab-ink-25);
          border-radius: 999px;
          background: rgba(255, 253, 248, 0.58);
          overflow: hidden;
        }

        .lab-chart-page .lab-chart-symbol-form__label {
          display: inline-flex;
          align-items: center;
          padding: 0 0 0 14px;
          font-family: var(--lab-mono);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--lab-ink-55);
        }

        .lab-chart-page .lab-chart-symbol-form__input {
          width: 82px;
          min-width: 0;
          border: 0;
          background: transparent;
          padding: 0 10px;
          color: var(--lab-ink);
          font: 800 14px/1 var(--lab-mono);
          letter-spacing: 0;
          text-transform: uppercase;
          outline: 0;
        }

        .lab-chart-page .lab-chart-symbol-form__input:focus {
          background: rgba(255, 255, 255, 0.68);
        }

        .lab-chart-page .lab-chart-symbol-form__button {
          border: 0;
          border-left: 1px solid var(--lab-ink-25);
          background: rgba(37, 35, 31, 0.08);
          color: var(--lab-ink);
          padding: 0 14px;
          font: 800 11px/1 var(--lab-mono);
          letter-spacing: 1.2px;
          text-transform: uppercase;
          cursor: pointer;
        }

        .lab-chart-page .lab-chart-symbol-form__button:hover,
        .lab-chart-page .lab-chart-symbol-form__button:focus-visible {
          background: var(--lab-ink);
          color: var(--lab-paper);
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

        .lab-chart-page .lab-chart-realtime-status {
          position: absolute;
          top: 12px;
          left: 12px;
          z-index: 4;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          max-width: min(340px, calc(100% - 24px));
          padding: 6px 9px;
          border: 1px solid rgba(37, 35, 31, 0.24);
          background: rgba(255, 253, 248, 0.88);
          color: var(--lab-ink);
          font-family: var(--lab-mono);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 1px;
          line-height: 1.2;
          text-transform: uppercase;
          box-shadow: 0 6px 18px rgba(37, 35, 31, 0.08);
        }

        .lab-chart-page .lab-chart-realtime-status::before {
          content: "";
          width: 7px;
          height: 7px;
          flex: 0 0 auto;
          border-radius: 50%;
          background: var(--lab-ink-55);
        }

        .lab-chart-page .lab-chart-realtime-status--live::before {
          background: #15825e;
          box-shadow: 0 0 0 4px rgba(21, 130, 94, 0.14);
        }

        .lab-chart-page .lab-chart-realtime-status--connecting::before,
        .lab-chart-page .lab-chart-realtime-status--reconnecting::before {
          background: #b8860b;
          box-shadow: 0 0 0 4px rgba(184, 134, 11, 0.14);
        }

        .lab-chart-page .lab-chart-realtime-status--paused::before {
          background: #bf3b35;
          box-shadow: 0 0 0 4px rgba(191, 59, 53, 0.14);
        }

        .lab-chart-page .lab-chart-realtime-status small {
          min-width: 0;
          overflow: hidden;
          color: var(--lab-ink-55);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0;
          text-overflow: ellipsis;
          text-transform: none;
          white-space: nowrap;
        }
      `}
    </style>
  );
}
