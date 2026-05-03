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

// Editorial palette mirrors the Codex gap-week-report
// (public/wir/2026-05-02.html). See chart.css for the full set.
const C = {
  canvas: "#fffdf8",
  axis: "#494640",
  grid: "#e7dfd2",
  open: "#25231f",
  up: "#15825e",
  down: "#bf3b35",
  ink55: "rgba(21,18,11,0.55)",
  gold: "#B8860B",
  marker: "#255f85",
  fontSans: "Helvetica, Arial, sans-serif",
  // Volume bars at 0.38 alpha — Lightweight Charts has no per-series alpha,
  // so we feed rgba per data point.
  volumeUp: "rgba(21,130,94,0.38)",
  volumeDown: "rgba(191,59,53,0.38)",
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
        background: { type: ColorType.Solid, color: C.canvas },
        textColor: C.axis,
        fontFamily: C.fontSans,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: C.open, width: 1, style: LineStyle.Dotted },
        horzLine: { color: C.open, width: 1, style: LineStyle.Dotted },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: C.grid,
      },
      rightPriceScale: {
        borderColor: C.grid,
        scaleMargins: { top: 0.06, bottom: 0.2 },
      },
    });
    chartRef.current = chart;

    const candles: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
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

    // Compact volume strip (~17% of chart height).
    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: C.volumeUp,
    });
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.83, bottom: 0 },
    });
    volume.setData(
      bars.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color: b.close >= b.open ? C.volumeUp : C.volumeDown,
      })),
    );

    // Overlay lines. Filter NaN warmup so lightweight-charts doesn't reject points.
    const ema9Line = chart.addLineSeries({
      color: C.ink55,
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
      color: C.up,
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
      color: C.gold,
      lineWidth: 2,
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
          color: C.marker,
          shape: "arrowUp",
        });
      }
      if (indicator.exits[i]) {
        markers.push({
          time: bars[i].time as Time,
          position: "aboveBar",
          color: C.down,
          shape: "arrowDown",
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

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
