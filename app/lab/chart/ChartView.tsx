"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@/lib/polygon/types";
import type { RossCameronResult } from "@/lib/indicators";

type Props = {
  bars: Bar[];
  indicator: RossCameronResult;
};

// Hex literals copied verbatim from app/research/drop-and-pop/page.tsx THEMES.dark
// (lines 97-107). See PR description for var-extraction follow-up.
const C = {
  bg: "#0a0a0f",
  border: "#1e1e2e",
  grid: "#1a1a24",
  t3: "#aaaaaa",
  t4: "#888888",
  t5: "#666666",
  up: "#4ade80",
  down: "#f87171",
  warn: "#fbbf24",
  fontMono: '"IBM Plex Mono", ui-monospace, monospace',
} as const;

// Overlay-line treatment: VWAP is the hero (accent green, thick),
// PMH is the breakout level (warn amber, dashed), EMA9 is a dim baseline.
const OVERLAY = {
  ema9: C.t3,
  vwap: C.up,
  pmh: C.warn,
} as const;

export default function ChartView({ bars, indicator }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: C.bg },
        textColor: C.t5,
        fontFamily: C.fontMono,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: C.t4, width: 1, style: LineStyle.Dotted },
        horzLine: { color: C.t4, width: 1, style: LineStyle.Dotted },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: C.border,
      },
      rightPriceScale: {
        borderColor: C.border,
        scaleMargins: { top: 0.05, bottom: 0.28 },
      },
    });
    chartRef.current = chart;

    const candles: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up + "aa",
      wickDownColor: C.down + "aa",
    });

    candles.setData(
      bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    // Volume in the bottom ~25% as an overlay series.
    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: C.up + "55",
    });
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    volume.setData(
      bars.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color: (b.close >= b.open ? C.up : C.down) + "55",
      })),
    );

    // Overlay lines. Filter NaN warmup so lightweight-charts doesn't reject points.
    const ema9Line = chart.addLineSeries({
      color: OVERLAY.ema9,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema9Line.setData(
      bars
        .map((b, i) => ({ time: b.time as Time, value: indicator.ema9[i] }))
        .filter((p) => Number.isFinite(p.value)),
    );

    const vwapLine = chart.addLineSeries({
      color: OVERLAY.vwap,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    vwapLine.setData(
      bars
        .map((b, i) => ({ time: b.time as Time, value: indicator.vwap[i] }))
        .filter((p) => Number.isFinite(p.value)),
    );

    const pmhLine = chart.addLineSeries({
      color: OVERLAY.pmh,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    pmhLine.setData(
      bars
        .map((b, i) => ({ time: b.time as Time, value: indicator.pmHigh[i] }))
        .filter((p) => p.value > 0),
    );

    const markers: Array<{
      time: Time;
      position: "aboveBar" | "belowBar";
      color: string;
      shape: "arrowUp" | "arrowDown";
      text?: string;
    }> = [];
    for (let i = 0; i < bars.length; i++) {
      if (indicator.entries[i]) {
        markers.push({
          time: bars[i].time as Time,
          position: "belowBar",
          color: C.up,
          shape: "arrowUp",
          text: "ENTRY",
        });
      }
      if (indicator.exits[i]) {
        markers.push({
          time: bars[i].time as Time,
          position: "aboveBar",
          color: C.down,
          shape: "arrowDown",
          text: "EXIT",
        });
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    candles.setMarkers(markers);

    chart.timeScale().fitContent();

    const handleResize = () => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, indicator]);

  const { latest } = indicator;
  const rvolStr = Number.isFinite(latest.rvol) ? latest.rvol.toFixed(2) : "—";
  const pmhStr = latest.pmHigh > 0 ? `$${latest.pmHigh.toFixed(2)}` : "—";

  return (
    <div className="lab-chart-body">
      <div ref={containerRef} className="lab-chart-container" />
      <div className="lab-chart-info">
        <div className="lab-chart-info__grid">
          <div className="lab-chart-info__cell">
            <div className="lab-chart-info__label">RVOL</div>
            <div
              className={
                "lab-chart-info__value " +
                (Number.isFinite(latest.rvol) && latest.rvol >= 5
                  ? "lab-chart-info__value--up"
                  : "")
              }
            >
              {rvolStr}
            </div>
          </div>
          <div className="lab-chart-info__cell">
            <div className="lab-chart-info__label">PM HIGH</div>
            <div className="lab-chart-info__value">{pmhStr}</div>
          </div>
          <div className="lab-chart-info__cell">
            <div className="lab-chart-info__label">ABOVE PMH</div>
            <div
              className={
                "lab-chart-info__value " +
                (latest.abovePMH ? "lab-chart-info__value--up" : "lab-chart-info__value--down")
              }
            >
              {latest.abovePMH ? "YES" : "NO"}
            </div>
          </div>
          <div className="lab-chart-info__cell">
            <div className="lab-chart-info__label">STATUS</div>
            <div
              className={
                "lab-chart-info__value lab-chart-info__status--" + latest.status
              }
            >
              {latest.status}
            </div>
          </div>
        </div>
        <div className="lab-chart-info__legend">
          <div className="lab-chart-info__legend-row">
            <span className="lab-chart-info__swatch" style={{ background: OVERLAY.ema9 }} />
            EMA 9
          </div>
          <div className="lab-chart-info__legend-row">
            <span
              className="lab-chart-info__swatch"
              style={{ background: OVERLAY.vwap, height: 3 }}
            />
            VWAP
          </div>
          <div className="lab-chart-info__legend-row">
            <span
              className="lab-chart-info__swatch"
              style={{
                background: `repeating-linear-gradient(to right, ${OVERLAY.pmh} 0 4px, transparent 4px 7px)`,
              }}
            />
            PM HIGH
          </div>
        </div>
      </div>
    </div>
  );
}
