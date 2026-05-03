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
  ticker: string;
  etDate: string;
  bars: Bar[];
  indicator: RossCameronResult;
};

const COLORS = {
  up: "#4ade80",
  down: "#f87171",
  upWick: "#4ade80aa",
  downWick: "#f87171aa",
  ema9: "#6b8afd",
  vwap: "#fb923c",
  pmh: "#facc15",
  entry: "#a3e635",
  exit: "#f87171",
  grid: "#1a1a24",
  border: "#1e1e2e",
  text: "#888888",
  bg: "#0a0a0f",
  volumeUp: "#4ade8055",
  volumeDown: "#f8717155",
};

function formatEtTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

export default function ChartView({ ticker, etDate, bars, indicator }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: COLORS.text, width: 1, style: LineStyle.Dotted },
        horzLine: { color: COLORS.text, width: 1, style: LineStyle.Dotted },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: COLORS.border,
      },
      rightPriceScale: {
        borderColor: COLORS.border,
        scaleMargins: { top: 0.05, bottom: 0.28 },
      },
    });
    chartRef.current = chart;

    const candles: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.upWick,
      wickDownColor: COLORS.downWick,
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

    // Volume in bottom ~25% as an overlay series.
    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: COLORS.volumeUp,
    });
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });
    volume.setData(
      bars.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color: b.close >= b.open ? COLORS.volumeUp : COLORS.volumeDown,
      })),
    );

    // Overlay lines. Filter NaN warmup so lightweight-charts doesn't reject points.
    const ema9Line = chart.addLineSeries({
      color: COLORS.ema9,
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
      color: COLORS.vwap,
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
      color: COLORS.pmh,
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

    // Entry/exit markers on the candle series.
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
          color: COLORS.entry,
          shape: "arrowUp",
          text: "ENTRY",
        });
      }
      if (indicator.exits[i]) {
        markers.push({
          time: bars[i].time as Time,
          position: "aboveBar",
          color: COLORS.exit,
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

  const firstTime = bars[0]?.time;
  const lastTime = bars[bars.length - 1]?.time;
  const summary =
    firstTime && lastTime
      ? `${ticker} · ${etDate} · 1m bars · ${bars.length} bars loaded · ${formatEtTime(firstTime)}–${formatEtTime(lastTime)} ET`
      : `${ticker} · ${etDate} · 1m bars · 0 bars loaded`;

  const { latest } = indicator;
  const rvolStr = Number.isFinite(latest.rvol) ? latest.rvol.toFixed(2) : "—";
  const pmhStr = latest.pmHigh > 0 ? `$${latest.pmHigh.toFixed(2)}` : "—";

  return (
    <>
      <div className="lab-chart-summary">{summary}</div>
      <div className="lab-chart-body">
        <div ref={containerRef} className="lab-chart-container" />
        <div className="lab-chart-info">
          <div className="lab-chart-info__row">
            <span className="lab-chart-info__label">RVOL</span>
            <span className="lab-chart-info__value">{rvolStr}</span>
          </div>
          <div className="lab-chart-info__row">
            <span className="lab-chart-info__label">PM High</span>
            <span className="lab-chart-info__value">{pmhStr}</span>
          </div>
          <div className="lab-chart-info__row">
            <span className="lab-chart-info__label">Above PMH</span>
            <span
              className={
                "lab-chart-info__value " +
                (latest.abovePMH ? "lab-chart-info__value--ok" : "lab-chart-info__value--bad")
              }
            >
              {latest.abovePMH ? "YES" : "NO"}
            </span>
          </div>
          <div className="lab-chart-info__row">
            <span className="lab-chart-info__label">Status</span>
            <span
              className={
                "lab-chart-info__value lab-chart-info__status--" + latest.status
              }
            >
              {latest.status}
            </span>
          </div>
          <div className="lab-chart-info__legend">
            <div className="lab-chart-info__legend-row">
              <span className="lab-chart-info__swatch" style={{ background: COLORS.ema9 }} />
              EMA 9
            </div>
            <div className="lab-chart-info__legend-row">
              <span
                className="lab-chart-info__swatch"
                style={{ background: COLORS.vwap, height: 3 }}
              />
              VWAP
            </div>
            <div className="lab-chart-info__legend-row">
              <span
                className="lab-chart-info__swatch"
                style={{
                  background: `repeating-linear-gradient(to right, ${COLORS.pmh} 0 4px, transparent 4px 7px)`,
                }}
              />
              PM High
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
