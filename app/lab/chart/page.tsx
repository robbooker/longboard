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

export default async function LabChartPage() {
  const ticker = DEFAULT_TICKER;
  const etDate = DEFAULT_DATE_ET;

  let bars;
  try {
    bars = await fetchMinuteBarsForDay(ticker, etDate);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      <div className="lab-chart-page">
        <Header />
        <ErrorState ticker={ticker} etDate={etDate} message={message} />
      </div>
    );
  }

  if (bars.length === 0) {
    return (
      <div className="lab-chart-page">
        <Header />
        <ErrorState
          ticker={ticker}
          etDate={etDate}
          message="No bars returned from Polygon for this ticker/date. Check that the ticker traded that day and that POLYGON_API_KEY has access."
        />
      </div>
    );
  }

  const indicator = rossCameronMomentum(bars);
  const firstTime = bars[0].time;
  const lastTime = bars[bars.length - 1].time;
  const window = `${formatEtTime(firstTime)}–${formatEtTime(lastTime)} ET`;

  return (
    <div className="lab-chart-page">
      <Header />
      <div className="lab-chart-summary">
        <span className="lab-chart-summary__chip">TICKER<strong>{ticker}</strong></span>
        <span className="lab-chart-summary__chip">DATE<strong>{etDate}</strong></span>
        <span className="lab-chart-summary__chip">RES<strong>1m</strong></span>
        <span className="lab-chart-summary__chip">BARS<strong>{bars.length}</strong></span>
        <span className="lab-chart-summary__chip">WINDOW<strong>{window}</strong></span>
      </div>
      <ChartView bars={bars} indicator={indicator} />
    </div>
  );
}

function Header() {
  return (
    <div className="lab-chart-header">
      <h1 className="lab-chart-header__title">LAB · MOMENTUM SCAN</h1>
    </div>
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
