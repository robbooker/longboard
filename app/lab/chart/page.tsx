import Link from "next/link";
import { fetchBarsForDay, type Resolution } from "@/lib/polygon/bars";
import {
  rossCameronMomentum,
  rvolLookbackForResolution,
} from "@/lib/indicators";
import { computeSessionBoundaries } from "@/lib/time/sessionBoundaries";
import { loadDefaultWIRWeek } from "@/lib/wir/loader";
import { sortEvents, DEFAULT_SORT } from "@/lib/wir/sort";
import type { GapEvent, WIRWeek } from "@/lib/wir/types";
import WIRWatchlist from "./WIRWatchlist";
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

/** Build a /lab/chart URL preserving non-default params. */
function buildChartHref(
  ticker: string,
  etDate: string,
  resolution: Resolution,
): string {
  const params = new URLSearchParams({ ticker, date: etDate });
  if (resolution !== DEFAULT_RESOLUTION) params.set("res", resolution);
  return `/lab/chart?${params.toString()}`;
}

type WIRResult =
  | { ok: true; week: WIRWeek }
  | { ok: false; message: string };

async function loadWIR(): Promise<WIRResult> {
  try {
    const week = await loadDefaultWIRWeek();
    return { ok: true, week };
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

  const wirResult = await loadWIR();
  const week: WIRWeek | null = wirResult.ok ? wirResult.week : null;
  const wirError = wirResult.ok ? null : wirResult.message;

  // Default selection: top long_score event from the published WIR week.
  // Falls back to OSRH 2026-04-30 if the WIR file is missing or empty.
  const sortedEvents: GapEvent[] = week
    ? sortEvents(week.events, DEFAULT_SORT.key, DEFAULT_SORT.dir)
    : [];
  const defaultEvent = sortedEvents[0];

  const ticker = tickerParam ?? defaultEvent?.ticker ?? FALLBACK_TICKER;
  const etDate = dateParam ?? defaultEvent?.gap_date ?? FALLBACK_DATE_ET;

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
            week={week}
            wirError={wirError}
            currentTicker={ticker}
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
  week,
  wirError,
  currentTicker,
  resolution,
}: {
  week: WIRWeek | null;
  wirError: string | null;
  currentTicker: string;
  resolution: Resolution;
}) {
  return (
    <aside className="lab-chart-side">
      {wirError ? (
        <section>
          <div className="lab-chart-side__section-eyebrow">Week in Review</div>
          <div className="lab-chart-watchlist__error">
            <div className="lab-chart-watchlist__error-title">
              WIR data load failed
            </div>
            <pre className="lab-chart-watchlist__error-message">{wirError}</pre>
          </div>
        </section>
      ) : week ? (
        <WIRWatchlist
          week={week}
          activeTicker={currentTicker}
          res={resolution}
        />
      ) : null}
    </aside>
  );
}
