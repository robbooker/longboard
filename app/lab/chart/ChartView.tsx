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
import type { SessionBoundaries } from "@/lib/time/sessionBoundaries";

type Props = {
  bars: Bar[];
  indicator: RossCameronResult;
  sessions: SessionBoundaries;
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

// Session band colors (RGBA). Tuned to read as three distinct zones on
// the editorial cream canvas — blue takes the largest alpha because it
// desaturates more on a warm background than gold or green do.
const BAND = {
  premarket: "rgba(184,131,22,0.14)",   // gold
  regular:   "rgba(21,130,94,0.10)",    // green
  afterHours:"rgba(37,95,133,0.16)",    // blue
} as const;

// Lightweight Charts defaults the time-axis labels and crosshair tooltip
// to the browser's local timezone. We always want ET — a viewer in PT
// shouldn't see "01:00" on the axis when the bar is from 04:00 ET.
const ET_TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatEtAxisTime(time: Time): string {
  if (typeof time !== "number") return String(time);
  return ET_TIME_FMT.format(new Date(time * 1000));
}

export default function ChartView({ bars, indicator, sessions }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const bandCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const chartContainer = chartContainerRef.current;
    const bandCanvas = bandCanvasRef.current;
    if (!wrapper || !chartContainer || !bandCanvas) return;
    const bandCtx = bandCanvas.getContext("2d");
    if (!bandCtx) return;

    const chart = createChart(chartContainer, {
      width: chartContainer.clientWidth,
      height: chartContainer.clientHeight,
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
      localization: {
        timeFormatter: formatEtAxisTime,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: C.grid,
        tickMarkFormatter: formatEtAxisTime,
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

    // Only render entry markers. Exit signals are still computed (indicator.exits
    // is available for backtests / panels) but rendering them on a 957-bar
    // session creates visual noise that drowns the entries. The chart's job
    // here is to make the moment of entry obvious.
    const markers: Array<{
      time: Time;
      position: "aboveBar" | "belowBar";
      color: string;
      shape: "arrowUp" | "arrowDown";
      size?: number;
      text?: string;
    }> = [];
    for (let i = 0; i < bars.length; i++) {
      if (indicator.entries[i]) {
        markers.push({
          time: bars[i].time as Time,
          position: "belowBar",
          color: C.marker,
          shape: "arrowUp",
          size: 2,
          text: "BUY",
        });
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    candles.setMarkers(markers);

    // Pin the initial visible range to the full ET session window
    // (04:00–20:00) instead of fitContent. fitContent's first paint can
    // be flaky if the container's width hasn't fully settled, and it
    // doesn't account for premarket/after-hours dead zones where no bars
    // exist — meaning bands clipped at first/last bar times rather than
    // session edges. Anchoring to session bounds also guarantees that
    // band-edge timeToCoordinate calls land exactly on the visible range
    // edges, where the function is well-defined.
    chart.timeScale().setVisibleRange({
      from: sessions.pmStart as Time,
      to: sessions.ahEnd as Time,
    });

    // ── Session shading overlay ──────────────────────────────────────
    function resizeBandCanvas() {
      const w = wrapper!.clientWidth;
      const h = wrapper!.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      bandCanvas!.width = w * dpr;
      bandCanvas!.height = h * dpr;
      bandCanvas!.style.width = `${w}px`;
      bandCanvas!.style.height = `${h}px`;
      // Reset, don't compound — repeated resizes shouldn't multiply the scale.
      bandCtx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawBands() {
      const w = wrapper!.clientWidth;
      const h = wrapper!.clientHeight;
      bandCtx!.clearRect(0, 0, w, h);

      const ts = chart.timeScale();
      const visible = ts.getVisibleRange();
      if (!visible) return;
      const candleAreaWidth = ts.width();
      const visFrom = visible.from as number;
      const visTo = visible.to as number;

      const bands: ReadonlyArray<{ from: number; to: number; color: string }> = [
        { from: sessions.pmStart, to: sessions.rthStart, color: BAND.premarket },
        { from: sessions.rthStart, to: sessions.rthEnd, color: BAND.regular },
        { from: sessions.rthEnd, to: sessions.ahEnd, color: BAND.afterHours },
      ];

      for (const b of bands) {
        // Skip if the band is entirely outside the visible window.
        if (b.to <= visFrom || b.from >= visTo) continue;
        // Clamp the band's edges into the visible window before asking
        // the time scale for x.
        const fromTime = Math.max(b.from, visFrom);
        const toTime = Math.min(b.to, visTo);
        // timeToCoordinate can return null right at the visible-range
        // edges; in that case, snap to the chart's edge (left for the
        // start, right for the end) since the band reaches the edge by
        // construction.
        const rawFromX = ts.timeToCoordinate(fromTime as Time);
        const rawToX = ts.timeToCoordinate(toTime as Time);
        const fromX =
          rawFromX != null ? rawFromX : fromTime <= visFrom ? 0 : null;
        const toX =
          rawToX != null
            ? rawToX
            : toTime >= visTo
              ? candleAreaWidth
              : null;
        if (fromX == null || toX == null) continue;
        const x0 = Math.max(0, Math.min(candleAreaWidth, fromX));
        const x1 = Math.max(0, Math.min(candleAreaWidth, toX));
        if (x1 > x0) {
          bandCtx!.fillStyle = b.color;
          bandCtx!.fillRect(x0, 0, x1 - x0, h);
        }
      }
    }

    resizeBandCanvas();
    chart.timeScale().subscribeVisibleTimeRangeChange(drawBands);
    // Initial draw on the next frame so the chart has finished its first
    // layout pass and timeToCoordinate returns real numbers.
    const rafId = requestAnimationFrame(drawBands);

    // ResizeObserver handles the wrapper changing size for any reason —
    // window resize, mobile breakpoint, container reflow.
    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width: wrapper.clientWidth,
        height: wrapper.clientHeight,
      });
      resizeBandCanvas();
      drawBands();
    });
    ro.observe(wrapper);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(drawBands);
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, indicator, sessions]);

  return (
    <div ref={wrapperRef} className="lab-chart-canvas-wrapper">
      <div ref={chartContainerRef} className="lab-chart-canvas-wrapper__chart" />
      <canvas ref={bandCanvasRef} className="lab-chart-session-bands" />
    </div>
  );
}
