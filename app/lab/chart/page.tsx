import { fetchMinuteBarsForDay } from "@/lib/polygon/bars";
import { rossCameronMomentum } from "@/lib/indicators";
import ChartView from "./ChartView";
import "./chart.css";

export const dynamic = "force-dynamic";

const DEFAULT_TICKER = "OSRH";
const DEFAULT_DATE_ET = "2026-04-30";

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
        <ErrorState ticker={ticker} etDate={etDate} message={message} />
      </div>
    );
  }

  if (bars.length === 0) {
    return (
      <div className="lab-chart-page">
        <ErrorState
          ticker={ticker}
          etDate={etDate}
          message="No bars returned from Polygon for this ticker/date. Check that the ticker traded that day and that POLYGON_API_KEY has access."
        />
      </div>
    );
  }

  const indicator = rossCameronMomentum(bars);

  return (
    <div className="lab-chart-page">
      <ChartView ticker={ticker} etDate={etDate} bars={bars} indicator={indicator} />
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
