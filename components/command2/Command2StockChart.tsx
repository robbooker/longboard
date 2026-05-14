"use client";

import { useEffect, useState } from "react";
import ChartView from "@/app/lab/chart/ChartView";
import { CHART_RESOLUTIONS, type Resolution } from "@/lib/polygon/bars";
import type { Bar } from "@/lib/polygon/types";
import type { RossCameronResult } from "@/lib/indicators";
import type { SessionBoundaries } from "@/lib/time/sessionBoundaries";

type ChartPayload = {
  ticker: string;
  etDate: string;
  resolution: Resolution;
  bars: Bar[];
  indicator: RossCameronResult;
  sessions: SessionBoundaries | SessionBoundaries[];
  fetchedAt: string;
};

type Props = {
  ticker: string;
  rankLabel: string;
};

type LoadState =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: ChartPayload | null; error: null }
  | { status: "ready"; data: ChartPayload; error: null }
  | { status: "error"; data: ChartPayload | null; error: string };

const REFRESH_MS = 60_000;

function formatResolutionLabel(resolution: Resolution): string {
  return resolution === "1d" ? "Daily" : resolution.toUpperCase();
}

function formatFetchedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

async function fetchChart(ticker: string, resolution: Resolution, signal?: AbortSignal) {
  const params = new URLSearchParams({ ticker, res: resolution });
  const response = await fetch(`/api/command2/chart-bars?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof json?.error === "string" ? json.error : "Unable to load chart.",
    );
  }
  return json as ChartPayload;
}

export function Command2EmbeddedStockChart({ ticker, rankLabel }: Props) {
  const [resolution, setResolution] = useState<Resolution>("1m");
  const [state, setState] = useState<LoadState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const load = async (showLoading: boolean) => {
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      if (showLoading) {
        setState((current) => ({
          status: "loading",
          data: current.data,
          error: null,
        }));
      }
      try {
        const data = await fetchChart(ticker, resolution, currentController.signal);
        if (!cancelled) {
          setState({ status: "ready", data, error: null });
        }
      } catch (error) {
        if (currentController.signal.aborted || cancelled) return;
        const message = error instanceof Error ? error.message : "Unable to load chart.";
        setState((current) => ({
          status: "error",
          data: current.data,
          error: message,
        }));
      }
    };

    void load(true);
    const id = window.setInterval(() => void load(false), REFRESH_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(id);
    };
  }, [resolution, ticker]);

  const data = state.data;
  const isBusy = state.status === "loading";
  const hasChart = data && data.bars.length > 0;

  return (
    <div className="cc2-embedded-chart">
      <div className="cc2-embedded-chart__head">
        <div>
          <div className="mono">chart · {rankLabel}</div>
          <strong>{ticker}</strong>
          {data && <span>{data.etDate}</span>}
        </div>
        <div className="cc2-embedded-chart__controls" aria-label={`${ticker} chart resolution`}>
          {CHART_RESOLUTIONS.map((nextResolution) => (
            <button
              key={nextResolution}
              type="button"
              aria-pressed={resolution === nextResolution}
              onClick={() => setResolution(nextResolution)}
              className={resolution === nextResolution ? "active" : ""}
            >
              {formatResolutionLabel(nextResolution)}
            </button>
          ))}
        </div>
      </div>

      <div className="cc2-embedded-chart__meta mono">
        <span>{state.status === "error" ? "error" : isBusy ? "loading" : "live minute refresh"}</span>
        <span>{data ? `${data.bars.length} bars` : "no bars yet"}</span>
        <span>{data ? `as of ${formatFetchedAt(data.fetchedAt)} ET` : "opens on demand"}</span>
      </div>

      {state.status === "error" && (
        <div className="cc2-chart-message" role="status">
          {state.error}
        </div>
      )}

      {hasChart ? (
        <ChartView
          key={`${data.ticker}-${data.etDate}-${data.resolution}`}
          bars={data.bars}
          indicator={data.indicator}
          sessions={data.sessions}
          resolution={data.resolution}
        />
      ) : state.status === "loading" ? (
        <div className="cc2-chart-message" role="status">
          Loading {ticker} chart...
        </div>
      ) : state.status !== "error" ? (
        <div className="cc2-chart-message" role="status">
          No chart data returned for {ticker}.
        </div>
      ) : null}

      <style>{embeddedChartStyles}</style>
    </div>
  );
}

export default function Command2StockChart({ ticker, rankLabel }: Props) {
  const [open, setOpen] = useState(false);
  const chartId = `cc2-chart-${ticker}-${rankLabel}`;

  return (
    <div className="cc2-chart-accordion">
      <button
        type="button"
        className="cc2-chart-toggle"
        aria-expanded={open}
        aria-controls={chartId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="mono">{open ? "hide chart" : "open chart"}</span>
        <span>{ticker}</span>
        <span className="cc2-chart-toggle__meta">
          {open ? "chart open" : "loads on demand"}
        </span>
      </button>

      {open && (
        <div id={chartId}>
          <Command2EmbeddedStockChart ticker={ticker} rankLabel={rankLabel} />
        </div>
      )}

      <style>{`
        .cc2-chart-accordion{
          border-top:1px solid var(--ink-30);
          background:rgba(251,248,240,0.72);
        }
        .cc2-chart-toggle{
          width:100%;
          display:grid;
          grid-template-columns:auto 1fr auto;
          align-items:center;
          gap:14px;
          border:0;
          background:transparent;
          color:var(--ink);
          padding:14px 22px;
          cursor:pointer;
          text-align:left;
        }
        .cc2-chart-toggle:hover,
        .cc2-chart-toggle:focus-visible{
          background:rgba(245,165,36,0.12);
          outline:none;
        }
        .cc2-chart-toggle .mono{
          color:var(--gold);
          font-size:10px;
        }
        .cc2-chart-toggle > span:nth-child(2){
          font-size:18px;
          font-weight:800;
          letter-spacing:-0.4px;
        }
        .cc2-chart-toggle__meta{
          font-family:'Courier New',Courier,monospace;
          font-size:10px;
          letter-spacing:1.2px;
          color:var(--ink-55);
          font-weight:700;
          text-transform:uppercase;
        }
        @media (max-width:768px){
          .cc2-chart-toggle{
            grid-template-columns:1fr;
            gap:5px;
            padding:13px 18px;
          }
        }
      `}</style>
    </div>
  );
}

const embeddedChartStyles = `
  .cc2-embedded-chart{
    --cc2-chart-price-gutter:44px;
    padding:16px 22px 22px;
    border-top:1px dashed var(--ink-30, rgba(21,18,11,0.25));
    background:rgba(251,248,240,0.72);
  }
  .cc2-embedded-chart__head{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:14px;
    margin-bottom:10px;
  }
  .cc2-embedded-chart__head .mono{
    color:var(--gold, #B8860B);
    font-size:10px;
    margin-bottom:4px;
  }
  .cc2-embedded-chart__head strong{
    display:inline-block;
    font-size:28px;
    line-height:1;
    letter-spacing:0;
    margin-right:10px;
  }
  .cc2-embedded-chart__head span{
    font-family:'Courier New',Courier,monospace;
    font-size:11px;
    color:var(--ink-55, rgba(21,18,11,0.55));
    letter-spacing:1.1px;
    font-weight:700;
  }
  .cc2-embedded-chart__controls{
    display:inline-flex;
    border:1px solid var(--ink-30, rgba(21,18,11,0.25));
    background:var(--card-2, #F6F2E9);
  }
  .cc2-embedded-chart__controls button{
    min-width:52px;
    border:0;
    border-right:1px solid var(--ink-30, rgba(21,18,11,0.25));
    background:transparent;
    color:var(--ink-55, rgba(21,18,11,0.55));
    padding:9px 13px;
    cursor:pointer;
    font-family:'Courier New',Courier,monospace;
    font-size:11px;
    letter-spacing:1.4px;
    font-weight:800;
  }
  .cc2-embedded-chart__controls button:last-child{
    border-right:0;
  }
  .cc2-embedded-chart__controls button.active{
    background:var(--ink, #15120B);
    color:var(--amber, #F5A524);
  }
  .cc2-embedded-chart__meta{
    display:flex;
    gap:14px;
    flex-wrap:wrap;
    color:var(--ink-55, rgba(21,18,11,0.55));
    font-size:10px;
    margin-bottom:10px;
  }
  .cc2-chart-message{
    min-height:300px;
    display:grid;
    place-items:center;
    border:1px solid var(--ink-30, rgba(21,18,11,0.25));
    background:#fff;
    color:var(--ink-55, rgba(21,18,11,0.55));
    font-family:'Courier New',Courier,monospace;
    font-size:11px;
    letter-spacing:1.2px;
    font-weight:700;
    text-transform:uppercase;
  }
  .cc2-embedded-chart .lab-chart-canvas-wrapper{
    position:relative;
    height:360px;
    min-height:360px;
    width:100%;
    overflow:hidden;
    border:1px solid var(--ink-30, rgba(21,18,11,0.25));
    background:#fff;
  }
  .cc2-embedded-chart .lab-chart-canvas-wrapper__chart{
    position:absolute;
    inset:0 var(--cc2-chart-price-gutter) 0 0;
  }
  .cc2-embedded-chart .lab-chart-session-bands{
    position:absolute;
    inset:0 var(--cc2-chart-price-gutter) 0 0;
    pointer-events:none;
    z-index:1;
  }
  .cc2-embedded-chart .lab-chart-indicators{
    position:absolute;
    left:12px;
    bottom:12px;
    z-index:2;
    display:flex;
    flex-wrap:wrap;
    gap:6px;
    max-width:calc(100% - 24px);
    padding:8px;
    border:1px solid var(--ink-30, rgba(21,18,11,0.25));
    background:rgba(251,248,240,0.92);
    box-shadow:0 10px 28px rgba(21,18,11,0.10);
  }
  .cc2-embedded-chart .lab-chart-indicators__button{
    min-width:48px;
    border:1px solid var(--ink-30, rgba(21,18,11,0.25));
    background:#fff;
    color:var(--ink-55, rgba(21,18,11,0.55));
    padding:8px 10px;
    cursor:pointer;
    font-family:'Courier New',Courier,monospace;
    font-size:10px;
    letter-spacing:1.1px;
    font-weight:800;
    text-transform:uppercase;
  }
  .cc2-embedded-chart .lab-chart-indicators__button:hover,
  .cc2-embedded-chart .lab-chart-indicators__button:focus-visible{
    color:var(--ink, #15120B);
    outline:none;
  }
  .cc2-embedded-chart .lab-chart-indicators__button--active{
    background:var(--ink, #15120B);
    color:var(--paper, #F6F2E9);
    border-color:var(--ink, #15120B);
  }
  @media (max-width:768px){
    .cc2-embedded-chart{
      --cc2-chart-price-gutter:34px;
      padding:14px 18px 18px;
    }
    .cc2-embedded-chart__head{
      align-items:flex-start;
      flex-direction:column;
    }
    .cc2-embedded-chart .lab-chart-canvas-wrapper{
      height:300px;
      min-height:300px;
    }
    .cc2-embedded-chart .lab-chart-indicators{
      left:8px;
      right:8px;
      bottom:8px;
      max-width:none;
    }
    .cc2-embedded-chart .lab-chart-indicators__button{
      flex:1 1 62px;
    }
  }
`;
