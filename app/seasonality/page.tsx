import type { Metadata } from "next";
import { Fragment } from "react";
import Command2Header from "@/components/command2/Command2Header";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import {
  loadSeasonalityAnalysis,
  type SeasonalityAnalysis,
  type SeasonalityMonthStat,
  type SeasonalityPathPoint,
  type SeasonalityWindowAnalysis,
} from "@/lib/seasonality/analyze";
import {
  getSp100Constituent,
  SP100_CONSTITUENTS,
} from "@/lib/seasonality/sp100";
import "./seasonality.css";

export const metadata: Metadata = {
  title: "Seasonality · Longboard",
  description: "Stock seasonality from adjusted daily Polygon bars.",
};

export const dynamic = "force-dynamic";

const DEFAULT_TICKER = "NVDA";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WINDOW_META = {
  2: { label: "2Y", color: "#255f85" },
  5: { label: "5Y", color: "#b8860b" },
  10: { label: "10Y", color: "#15825e" },
} as const;
const TICKER_PATTERN = /^[A-Z0-9.]{1,12}$/;
const LIMITED_HISTORY_BARS = 120;

function stringParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeSeasonalityTicker(input: string | undefined | null): string | null {
  if (!input) return null;
  const ticker = input.trim().replace(/^\$/, "").toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

function formatPct(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatWinRate(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(0)}%`;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 2 : 3,
  }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function lastPathValue(points: SeasonalityPathPoint[]): number | null {
  return points.at(-1)?.averageReturnPct ?? null;
}

function monthClass(stat: SeasonalityMonthStat | undefined): string {
  const value = stat?.averageReturnPct;
  if (typeof value !== "number") return "";
  if (value > 0) return " is-up";
  if (value < 0) return " is-down";
  return "";
}

function rankedMonth(
  window: SeasonalityWindowAnalysis,
  direction: "best" | "worst",
): SeasonalityMonthStat | null {
  const ranked = window.monthly
    .filter((month) => typeof month.averageReturnPct === "number")
    .sort((a, b) => {
      const left = a.averageReturnPct ?? 0;
      const right = b.averageReturnPct ?? 0;
      return direction === "best" ? right - left : left - right;
    });
  return ranked[0] ?? null;
}

function buildPath(
  points: SeasonalityPathPoint[],
  scale: {
    x: (index: number) => number;
    y: (value: number) => number;
  },
): string {
  return points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${scale.x(point.index).toFixed(2)},${scale.y(point.averageReturnPct).toFixed(2)}`;
    })
    .join(" ");
}

function SeasonalitySvg({ windows }: { windows: SeasonalityWindowAnalysis[] }) {
  const width = 920;
  const height = 360;
  const padLeft = 54;
  const padRight = 18;
  const padTop = 24;
  const padBottom = 42;
  const series = windows.filter((window) => window.averagePath.length > 1);
  const values = series.flatMap((window) => window.averagePath.map((point) => point.averageReturnPct));
  const maxIndex = Math.max(1, ...series.flatMap((window) => window.averagePath.map((point) => point.index)));
  const rawMin = values.length ? Math.min(...values) : -5;
  const rawMax = values.length ? Math.max(...values) : 5;
  const min = Math.floor(Math.min(rawMin, -2) / 5) * 5;
  const max = Math.ceil(Math.max(rawMax, 2) / 5) * 5;
  const span = Math.max(1, max - min);
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const scale = {
    x: (index: number) => padLeft + (index / maxIndex) * plotWidth,
    y: (value: number) => padTop + ((max - value) / span) * plotHeight,
  };
  const zeroY = scale.y(0);
  const ticks = [min, 0, max].filter((value, index, arr) => arr.indexOf(value) === index);
  const quarterTicks = [
    { label: "Q1", x: 0 },
    { label: "Q2", x: Math.round(maxIndex * 0.25) },
    { label: "Q3", x: Math.round(maxIndex * 0.5) },
    { label: "Q4", x: Math.round(maxIndex * 0.75) },
    { label: "Y/E", x: maxIndex },
  ];

  return (
    <figure className="seasonality-chart" aria-label="Average trading-year seasonality chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <title>Average trading-year path for 2, 5, and 10 year windows</title>
        <rect x="0" y="0" width={width} height={height} rx="0" className="chart-bg" />
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padLeft} x2={width - padRight} y1={scale.y(tick)} y2={scale.y(tick)} className="chart-grid" />
            <text x={padLeft - 12} y={scale.y(tick) + 4} textAnchor="end" className="chart-axis">
              {formatPct(tick, 0)}
            </text>
          </g>
        ))}
        <line x1={padLeft} x2={width - padRight} y1={zeroY} y2={zeroY} className="chart-zero" />
        {quarterTicks.map((tick) => (
          <g key={tick.label}>
            <line x1={scale.x(tick.x)} x2={scale.x(tick.x)} y1={padTop} y2={height - padBottom} className="chart-grid chart-grid--vertical" />
            <text x={scale.x(tick.x)} y={height - 16} textAnchor="middle" className="chart-axis">
              {tick.label}
            </text>
          </g>
        ))}
        {series.map((window) => (
          <path
            key={window.years}
            d={buildPath(window.averagePath, scale)}
            fill="none"
            stroke={WINDOW_META[window.years].color}
            strokeWidth={window.years === 5 ? 4 : 3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <figcaption>
        {windows.map((window) => (
          <span key={window.years}>
            <i style={{ background: WINDOW_META[window.years].color }} /> {WINDOW_META[window.years].label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function WindowSummary({ window }: { window: SeasonalityWindowAnalysis }) {
  const best = rankedMonth(window, "best");
  const worst = rankedMonth(window, "worst");

  return (
    <article className="seasonality-window-card">
      <div>
        <p>{WINDOW_META[window.years].label}</p>
        <h2>{formatPct(lastPathValue(window.averagePath))}</h2>
      </div>
      <dl>
        <div>
          <dt>Years</dt>
          <dd>{window.observedYears.length}</dd>
        </div>
        <div>
          <dt>Bars</dt>
          <dd>{window.barCount.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd>{best ? `${MONTHS[best.month - 1]} ${formatPct(best.averageReturnPct)}` : "—"}</dd>
        </div>
        <div>
          <dt>Worst</dt>
          <dd>{worst ? `${MONTHS[worst.month - 1]} ${formatPct(worst.averageReturnPct)}` : "—"}</dd>
        </div>
      </dl>
    </article>
  );
}

function MonthlyTable({ windows }: { windows: SeasonalityWindowAnalysis[] }) {
  return (
    <section className="seasonality-panel seasonality-monthly">
      <header>
        <p>Calendar Month Tendencies</p>
        <h2>Average return and win rate</h2>
      </header>
      <div className="seasonality-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              {windows.map((window) => (
                <th key={window.years} colSpan={2}>{WINDOW_META[window.years].label}</th>
              ))}
            </tr>
            <tr>
              <th />
              {windows.map((window) => (
                <Fragment key={window.years}>
                  <th>Avg</th>
                  <th>Win</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((month, index) => (
              <tr key={month}>
                <th>{month}</th>
                {windows.map((window) => {
                  const stat = window.monthly[index];
                  return (
                    <Fragment key={`${window.years}-${month}`}>
                      <td className={monthClass(stat)}>
                        {formatPct(stat?.averageReturnPct)}
                      </td>
                      <td>
                        <span>{formatWinRate(stat?.winRatePct)}</span>
                        <small>{stat?.observations ? `${stat.observations}x` : "—"}</small>
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SeasonalityView({ analysis }: { analysis: SeasonalityAnalysis }) {
  const constituent = getSp100Constituent(analysis.ticker);
  const hasLimitedHistory = analysis.barsFetched < LIMITED_HISTORY_BARS;

  return (
    <>
      <section className="seasonality-hero">
        <div>
          <p className="seasonality-kicker">Stock Seasonality</p>
          <h1>{analysis.ticker}</h1>
          <p className="seasonality-name">
            {constituent ? `${constituent.name} · ${constituent.sector}` : "Polygon adjusted daily bars"}
          </p>
        </div>
        <div className="seasonality-stats">
          <div>
            <span>Last</span>
            <b>{formatPrice(analysis.latestClose)}</b>
          </div>
          <div>
            <span>As of</span>
            <b>{formatDate(analysis.asOf)}</b>
          </div>
          <div>
            <span>Daily bars</span>
            <b>{analysis.barsFetched.toLocaleString("en-US")}</b>
          </div>
        </div>
      </section>

      <section className="seasonality-controls-band">
        <form action="/seasonality" method="get" className="seasonality-controls">
          <label>
            <span>Ticker</span>
            <input
              name="ticker"
              defaultValue={analysis.ticker}
              list="sp100-seasonality-tickers"
              pattern="[A-Za-z0-9.]{1,12}"
              aria-label="Stock ticker"
            />
          </label>
          <button type="submit">Load</button>
          <datalist id="sp100-seasonality-tickers">
            {SP100_CONSTITUENTS.map((stock) => (
              <option key={stock.symbol} value={stock.symbol}>
                {stock.name}
              </option>
            ))}
          </datalist>
        </form>
        <p>Any US stock or ETF ticker · S&P 100 suggestions included · adjusted daily Polygon bars · cached 12h</p>
      </section>

      {hasLimitedHistory && (
        <div className="seasonality-warning">
          <b>Limited history.</b> Polygon returned {analysis.barsFetched.toLocaleString("en-US")} daily bars for {analysis.ticker}, so Longboard is showing the data it has.
        </div>
      )}

      <section className="seasonality-grid">
        <div className="seasonality-panel seasonality-main-chart">
          <header>
            <p>Average Trading-Year Path</p>
            <h2>2, 5, and 10-year tendency curves</h2>
          </header>
          <SeasonalitySvg windows={analysis.windows} />
        </div>
        <aside className="seasonality-window-stack">
          {analysis.windows.map((window) => (
            <WindowSummary key={window.years} window={window} />
          ))}
        </aside>
      </section>

      <MonthlyTable windows={analysis.windows} />
    </>
  );
}

function ErrorState({ message, ticker }: { message: string; ticker: string }) {
  return (
    <section className="seasonality-error">
      <p>Seasonality unavailable</p>
      <h1>{ticker}</h1>
      <pre>{message}</pre>
      <form action="/seasonality" method="get" className="seasonality-controls">
        <label>
          <span>Ticker</span>
          <input
            name="ticker"
            defaultValue={ticker}
            list="sp100-seasonality-tickers"
            pattern="[A-Za-z0-9.]{1,12}"
            aria-label="Stock ticker"
          />
        </label>
        <button type="submit">Retry</button>
        <datalist id="sp100-seasonality-tickers">
          {SP100_CONSTITUENTS.map((stock) => (
            <option key={stock.symbol} value={stock.symbol}>
              {stock.name}
            </option>
          ))}
        </datalist>
      </form>
    </section>
  );
}

export default async function SeasonalityPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const paramsPromise: Promise<Record<string, string | string[] | undefined>> =
    searchParams ?? Promise.resolve({});
  const [params, currentUser] = await Promise.all([
    paramsPromise,
    getCommand2CurrentUser(),
  ]);
  const requested = stringParam(params.ticker);
  const normalizedRequested = normalizeSeasonalityTicker(requested);
  const ticker = requested
    ? normalizedRequested ?? requested.trim().replace(/^\$/, "").toUpperCase().slice(0, 24)
    : DEFAULT_TICKER;
  let analysis: SeasonalityAnalysis | null = null;
  let error: string | null = null;

  if (requested && !normalizedRequested) {
    error = "Enter a stock ticker using letters, numbers, and dots only.";
  } else {
    try {
      analysis = await loadSeasonalityAnalysis(ticker);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <>
      <Command2Header activeTab="charts" currentUser={currentUser} />
      <main className="seasonality-page">
        <div className="seasonality-shell">
          {analysis ? <SeasonalityView analysis={analysis} /> : <ErrorState message={error ?? "Unknown error"} ticker={ticker} />}
        </div>
      </main>
    </>
  );
}
