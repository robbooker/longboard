import { fetchMinuteBarsForDay } from "@/lib/polygon/bars";
import { rossCameronMomentum } from "@/lib/indicators";
import ChartView from "./ChartView";
import "./chart.css";

export const dynamic = "force-dynamic";

const DEFAULT_TICKER = "OSRH";
const DEFAULT_DATE_ET = "2026-04-30";

function formatEtTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

function formatLedeDate(etDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(etDate);
  if (!m) return etDate;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default async function LabChartPage() {
  const ticker = DEFAULT_TICKER;
  const etDate = DEFAULT_DATE_ET;
  const ledeDate = formatLedeDate(etDate);

  let bars;
  try {
    bars = await fetchMinuteBarsForDay(ticker, etDate);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="lab-chart-page">
        <div className="lab-chart-shell">
          <Header ticker={ticker} ledeDate={ledeDate} />
          <ErrorState ticker={ticker} etDate={etDate} message={message} />
        </div>
      </div>
    );
  }

  if (bars.length === 0) {
    return (
      <div className="lab-chart-page">
        <div className="lab-chart-shell">
          <Header ticker={ticker} ledeDate={ledeDate} />
          <ErrorState
            ticker={ticker}
            etDate={etDate}
            message="No bars returned from Polygon for this ticker/date. Check that the ticker traded that day and that POLYGON_API_KEY has access."
          />
        </div>
      </div>
    );
  }

  const indicator = rossCameronMomentum(bars);
  const window = `${formatEtTime(bars[0].time)}–${formatEtTime(bars[bars.length - 1].time)} ET`;

  return (
    <div className="lab-chart-page">
      <div className="lab-chart-shell">
        <Header ticker={ticker} ledeDate={ledeDate} />
        <div className="lab-chart-summary">
          <SummaryPill label="TICKER" value={ticker} />
          <SummaryPill label="DATE" value={etDate} />
          <SummaryPill label="RES" value="1m" />
          <SummaryPill label="BARS" value={String(bars.length)} />
          <SummaryPill label="WINDOW" value={window} />
        </div>
        <div className="lab-chart-body">
          <div className="lab-chart-canvas">
            <div className="lab-chart-canvas__inner">
              <ChartView bars={bars} indicator={indicator} />
            </div>
          </div>
          <SidePanel indicator={indicator} />
        </div>
      </div>
    </div>
  );
}

function Header({ ticker, ledeDate }: { ticker: string; ledeDate: string }) {
  return (
    <header className="lab-chart-header">
      <div className="lab-chart-eyebrow">Longboard Lab · Momentum Scan</div>
      <h1 className="lab-chart-h1">{ticker}</h1>
      <p className="lab-chart-lede">
        Ross Cameron momentum signals on {ledeDate}.
      </p>
    </header>
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

function SidePanel({
  indicator,
}: {
  indicator: ReturnType<typeof rossCameronMomentum>;
}) {
  const { latest } = indicator;
  const rvolStr = Number.isFinite(latest.rvol) ? latest.rvol.toFixed(2) : "—";
  const pmhStr = latest.pmHigh > 0 ? `$${latest.pmHigh.toFixed(2)}` : "—";
  const rvolHot = Number.isFinite(latest.rvol) && latest.rvol >= 5;

  return (
    <aside className="lab-chart-side">
      <section>
        <div className="lab-chart-side__section-eyebrow">Watchlist</div>
        <h3 className="lab-chart-side__heading">Coming soon</h3>
        <p className="lab-chart-side__lede">
          Soon this panel will show the day&rsquo;s signal candidates ranked by
          RVOL, with click-to-load chart switching.
        </p>
      </section>

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
    </aside>
  );
}

function ErrorState({ ticker, etDate, message }: { ticker: string; etDate: string; message: string }) {
  return (
    <div className="lab-chart-error">
      <div className="lab-chart-error__title">Polygon fetch failed</div>
      <div className="lab-chart-error__meta">
        {ticker} · {etDate} · 1m bars
      </div>
      <pre className="lab-chart-error__message">{message}</pre>
    </div>
  );
}
