import Link from "next/link";
import { fetchBarsForDay, type Resolution } from "@/lib/polygon/bars";
import {
  rossCameronMomentum,
  rvolLookbackForResolution,
} from "@/lib/indicators";
import { fetchTopGainers } from "@/lib/gainers/topGainers";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";
import type { GainersData, PolygonTickerSnapshot } from "@/types/polygon";
import ChartView from "./ChartView";
import "./chart.css";

export const dynamic = "force-dynamic";

const FALLBACK_TICKER = "OSRH";
const FALLBACK_DATE_ET = "2026-04-30";
const SPARSE_BAR_THRESHOLD = 50;
const RESOLUTIONS: readonly Resolution[] = ["1m", "5m"] as const;
const DEFAULT_RESOLUTION: Resolution = "1m";

const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,5}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatEtTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
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

/** Build a /lab/chart URL preserving non-default params. Always emits
 *  ticker + date; res only when not default to keep canonical URLs short. */
function buildChartHref(
  ticker: string,
  etDate: string,
  resolution: Resolution,
): string {
  const params = new URLSearchParams({ ticker, date: etDate });
  if (resolution !== DEFAULT_RESOLUTION) params.set("res", resolution);
  return `/lab/chart?${params.toString()}`;
}

type GainersResult =
  | { ok: true; data: GainersData }
  | { ok: false; message: string };

async function loadGainers(): Promise<GainersResult> {
  try {
    const data = await fetchTopGainers({ limit: 10 });
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

export default async function LabChartPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const tickerParam = sanitizeTicker(stringParam(params.ticker));
  const dateParam = sanitizeDate(stringParam(params.date));
  const resolution = sanitizeResolution(stringParam(params.res)) ?? DEFAULT_RESOLUTION;

  const gainersResult = await loadGainers();
  const gainersList = gainersResult.ok ? gainersResult.data.tickers : [];
  const gainersError = gainersResult.ok ? null : gainersResult.message;

  // Resolve current ticker + date.
  const topGainer = gainersList[0]?.ticker ?? null;
  const ticker =
    tickerParam ?? topGainer ?? FALLBACK_TICKER;
  const etDate =
    dateParam ?? (topGainer ? mostRecentTradingDay() : FALLBACK_DATE_ET);

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
  const window =
    bars.length > 0
      ? `${formatEtTime(bars[0].time)}–${formatEtTime(bars[bars.length - 1].time)} ET`
      : "—";

  return (
    <div className="lab-chart-page">
      <div className="lab-chart-shell">
        <Header
          ticker={ticker}
          etDate={etDate}
          bars={bars.length}
          window={window}
          resolution={resolution}
        />
        <div className="lab-chart-body">
          <div className="lab-chart-canvas">
            <div className="lab-chart-canvas__inner">
              {bars.length > 0 && indicator ? (
                <>
                  {bars.length < SPARSE_BAR_THRESHOLD && (
                    <SparseTapeNotice resolution={resolution} />
                  )}
                  <ChartView bars={bars} indicator={indicator} />
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
            indicator={indicator}
            gainers={gainersList}
            gainersError={gainersError}
            currentTicker={ticker}
            etDate={etDate}
            resolution={resolution}
          />
        </div>
      </div>
    </div>
  );
}

function stringParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function Header({
  ticker,
  etDate,
  bars,
  window,
  resolution,
}: {
  ticker: string;
  etDate: string;
  bars: number;
  window: string;
  resolution: Resolution;
}) {
  return (
    <>
      <header className="lab-chart-header">
        <div className="lab-chart-header__title">
          <div className="lab-chart-eyebrow">Longboard Lab · RVOL Scan</div>
          <h1 className="lab-chart-headline__title">
            {ticker}
            <span className="lab-chart-headline__sep">·</span>
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
      Sparse {resolution} tape — indicator results may be unreliable.
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
        {ticker} · {etDate}
      </div>
      <p className="lab-chart-empty__lede">
        Polygon returned no {resolution} bars for this ticker on this trading
        day. Pick a different ticker from the watchlist, or check that the
        symbol traded that session.
      </p>
      {message && <pre className="lab-chart-empty__detail">{message}</pre>}
    </div>
  );
}

function SidePanel({
  indicator,
  gainers,
  gainersError,
  currentTicker,
  etDate,
  resolution,
}: {
  indicator: ReturnType<typeof rossCameronMomentum> | null;
  gainers: PolygonTickerSnapshot[];
  gainersError: string | null;
  currentTicker: string;
  etDate: string;
  resolution: Resolution;
}) {
  return (
    <aside className="lab-chart-side">
      <Watchlist
        gainers={gainers}
        gainersError={gainersError}
        currentTicker={currentTicker}
        etDate={etDate}
        resolution={resolution}
      />
      <CurrentBar indicator={indicator} />
    </aside>
  );
}

function Watchlist({
  gainers,
  gainersError,
  currentTicker,
  etDate,
  resolution,
}: {
  gainers: PolygonTickerSnapshot[];
  gainersError: string | null;
  currentTicker: string;
  etDate: string;
  resolution: Resolution;
}) {
  return (
    <section>
      <div className="lab-chart-side__section-eyebrow">
        Most Recent Trading Day · Top Gainers
      </div>
      <div className="lab-chart-watchlist__date">{etDate}</div>

      {gainersError ? (
        <div className="lab-chart-watchlist__error">
          <div className="lab-chart-watchlist__error-title">
            Gainers fetch failed
          </div>
          <pre className="lab-chart-watchlist__error-message">{gainersError}</pre>
        </div>
      ) : gainers.length === 0 ? (
        <p className="lab-chart-watchlist__empty">
          No gainers data available for the most recent trading day.
        </p>
      ) : (
        <ol className="lab-chart-watchlist">
          {gainers.map((g, i) => (
            <WatchlistRow
              key={g.ticker}
              rank={i + 1}
              snapshot={g}
              isActive={g.ticker === currentTicker}
              etDate={etDate}
              resolution={resolution}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function WatchlistRow({
  rank,
  snapshot,
  isActive,
  etDate,
  resolution,
}: {
  rank: number;
  snapshot: PolygonTickerSnapshot;
  isActive: boolean;
  etDate: string;
  resolution: Resolution;
}) {
  const rankStr = String(rank).padStart(2, "0");
  const pct = snapshot.todaysChangePerc;
  const pctStr = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const priceStr = `$${snapshot.day.c.toFixed(2)}`;
  const href = buildChartHref(snapshot.ticker, etDate, resolution);

  return (
    <li
      className={
        "lab-chart-watchlist__item" +
        (isActive ? " lab-chart-watchlist__item--active" : "")
      }
    >
      <Link
        href={href}
        className="lab-chart-watchlist__link"
        prefetch={false}
      >
        <span
          className={
            "lab-chart-watchlist__rank" +
            (rank === 1 ? " lab-chart-watchlist__rank--first" : "")
          }
        >
          {rankStr}
        </span>
        <span className="lab-chart-watchlist__ticker">{snapshot.ticker}</span>
        <span className="lab-chart-watchlist__price">{priceStr}</span>
        <span className="lab-chart-watchlist__pct">{pctStr}</span>
      </Link>
    </li>
  );
}

function CurrentBar({
  indicator,
}: {
  indicator: ReturnType<typeof rossCameronMomentum> | null;
}) {
  if (!indicator) {
    return (
      <section>
        <div className="lab-chart-side__section-eyebrow">Current bar</div>
        <p className="lab-chart-watchlist__empty">
          No bars loaded — indicator unavailable.
        </p>
      </section>
    );
  }

  const { latest } = indicator;
  const rvolStr = Number.isFinite(latest.rvol) ? latest.rvol.toFixed(2) : "—";
  const pmhStr = latest.pmHigh > 0 ? `$${latest.pmHigh.toFixed(2)}` : "—";
  const rvolHot = Number.isFinite(latest.rvol) && latest.rvol >= 5;

  return (
    <section>
      <div className="lab-chart-side__section-eyebrow">Current bar</div>
      <div className="lab-chart-tiles">
        <div className="lab-chart-tile">
          <div className="lab-chart-tile__label">RVOL</div>
          <div
            className={
              "lab-chart-tile__value " +
              (rvolHot
                ? "lab-chart-tile__value--up"
                : "lab-chart-tile__value--ink")
            }
          >
            {rvolStr}
          </div>
        </div>
        <div className="lab-chart-tile">
          <div className="lab-chart-tile__label">PM High</div>
          <div className="lab-chart-tile__value lab-chart-tile__value--ink">
            {pmhStr}
          </div>
        </div>
        <div className="lab-chart-tile">
          <div className="lab-chart-tile__label">Above PMH</div>
          <div
            className={
              "lab-chart-tile__value " +
              (latest.abovePMH
                ? "lab-chart-tile__value--up"
                : "lab-chart-tile__value--down")
            }
          >
            {latest.abovePMH ? "YES" : "NO"}
          </div>
        </div>
        <div className="lab-chart-tile">
          <div className="lab-chart-tile__label">Status</div>
          <div
            className={"lab-chart-tile__value lab-chart-tile__value--" + latest.status}
          >
            {latest.status}
          </div>
        </div>
      </div>
      <div className="lab-chart-legend">
        <div className="lab-chart-legend__row">
          <span
            className="lab-chart-legend__swatch"
            style={{ background: "#15825e", height: 3 }}
          />
          VWAP
        </div>
        <div className="lab-chart-legend__row">
          <span
            className="lab-chart-legend__swatch"
            style={{
              background:
                "repeating-linear-gradient(to right, #B8860B 0 5px, transparent 5px 9px)",
              height: 3,
            }}
          />
          PM High
        </div>
        <div className="lab-chart-legend__row">
          <span
            className="lab-chart-legend__swatch"
            style={{ background: "rgba(21,18,11,0.55)" }}
          />
          EMA 9
        </div>
      </div>
    </section>
  );
}
