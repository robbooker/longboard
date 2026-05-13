"use client";

import { useEffect, useRef, useState } from "react";
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
  sessions: SessionBoundaries | SessionBoundaries[];
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
};

const C = {
  canvas: "#ffffff",
  axis: "#494640",
  grid: "#e7dfd2",
  open: "#25231f",
  up: "#15825e",
  down: "#bf3b35",
  ink55: "rgba(21,18,11,0.55)",
  gold: "#B8860B",
  marker: "#255f85",
  blue: "#255f85",
  purple: "#7a3fa3",
  fontSans: "Helvetica, Arial, sans-serif",
  volumeUp: "rgba(21,130,94,0.38)",
  volumeDown: "rgba(191,59,53,0.38)",
} as const;

type IndicatorKey =
  | "vwap"
  | "ema9"
  | "ema20"
  | "pmHigh"
  | "pmLow"
  | "highOfDay"
  | "lowOfDay";

type IndicatorVisibility = Record<IndicatorKey, boolean>;

const INDICATORS: readonly { key: IndicatorKey; label: string }[] = [
  { key: "vwap", label: "VWAP" },
  { key: "ema9", label: "EMA 9" },
  { key: "ema20", label: "EMA 20" },
  { key: "pmHigh", label: "PMH" },
  { key: "pmLow", label: "PML" },
  { key: "highOfDay", label: "HOD" },
  { key: "lowOfDay", label: "LOD" },
];

const DEFAULT_INDICATORS: IndicatorVisibility = {
  vwap: true,
  ema9: true,
  ema20: false,
  pmHigh: true,
  pmLow: false,
  highOfDay: false,
  lowOfDay: false,
};

const BAND = {
  premarket: "rgba(184,131,22,0.14)",
  afterHours: "rgba(37,95,133,0.16)",
} as const;

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

function sessionList(
  sessions: SessionBoundaries | SessionBoundaries[],
): SessionBoundaries[] {
  return Array.isArray(sessions) ? sessions : [sessions];
}

function lineData(
  bars: Bar[],
  values: number[],
  show: boolean,
  keep: (value: number) => boolean = Number.isFinite,
) {
  if (!show) return [];
  return bars
    .map((b, i) => ({ time: b.time as Time, value: values[i] }))
    .filter((p) => keep(p.value));
}

export default function ChartView({
  bars,
  indicator,
  sessions,
  onLoadOlder,
  loadingOlder = false,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const bandCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const pmhRef = useRef<ISeriesApi<"Line"> | null>(null);
  const pmlRef = useRef<ISeriesApi<"Line"> | null>(null);
  const hodRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lodRef = useRef<ISeriesApi<"Line"> | null>(null);
  const prevBarsRef = useRef<Bar[]>([]);
  const sessionsRef = useRef(sessionList(sessions));
  const onLoadOlderRef = useRef(onLoadOlder);
  const loadingOlderRef = useRef(loadingOlder);
  const enableBackfillRef = useRef(false);
  const initializedRangeRef = useRef(false);
  const drawBandsRef = useRef<(() => void) | null>(null);
  const [visibleIndicators, setVisibleIndicators] =
    useState<IndicatorVisibility>(DEFAULT_INDICATORS);

  useEffect(() => {
    sessionsRef.current = sessionList(sessions);
  }, [sessions]);

  useEffect(() => {
    onLoadOlderRef.current = onLoadOlder;
  }, [onLoadOlder]);

  useEffect(() => {
    loadingOlderRef.current = loadingOlder;
  }, [loadingOlder]);

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

    const candles = chart.addCandlestickSeries({
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
    });
    candlesRef.current = candles;

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: C.volumeUp,
    });
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.83, bottom: 0 },
    });
    volumeRef.current = volume;

    ema9Ref.current = chart.addLineSeries({
      color: C.purple,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    ema20Ref.current = chart.addLineSeries({
      color: C.blue,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    vwapRef.current = chart.addLineSeries({
      color: C.up,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    pmlRef.current = chart.addLineSeries({
      color: C.down,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    hodRef.current = chart.addLineSeries({
      color: C.up,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    lodRef.current = chart.addLineSeries({
      color: C.down,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    pmhRef.current = chart.addLineSeries({
      color: C.gold,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    function resizeBandCanvas() {
      const w = bandCanvas!.clientWidth;
      const h = bandCanvas!.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      bandCanvas!.width = w * dpr;
      bandCanvas!.height = h * dpr;
      bandCtx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawBands() {
      const w = bandCanvas!.clientWidth;
      const h = bandCanvas!.clientHeight;
      bandCtx!.clearRect(0, 0, w, h);

      const ts = chart.timeScale();
      const visible = ts.getVisibleRange();
      if (!visible) return;
      const candleAreaWidth = ts.width();
      const visFrom = visible.from as number;
      const visTo = visible.to as number;

      const bands = sessionsRef.current.flatMap((s) => [
        { from: s.pmStart, to: s.rthStart, color: BAND.premarket },
        { from: s.rthEnd, to: s.ahEnd, color: BAND.afterHours },
      ]);

      for (const b of bands) {
        if (b.to <= visFrom || b.from >= visTo) continue;
        const fromTime = Math.max(b.from, visFrom);
        const toTime = Math.min(b.to, visTo);
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
    drawBandsRef.current = drawBands;

    function maybeLoadOlder(logicalRange: { from: number; to: number } | null) {
      if (
        !logicalRange ||
        !enableBackfillRef.current ||
        !onLoadOlderRef.current ||
        loadingOlderRef.current ||
        !candlesRef.current
      ) {
        return;
      }

      const info = candlesRef.current.barsInLogicalRange(logicalRange);
      if (info && info.barsBefore < 25) {
        onLoadOlderRef.current();
      }
    }

    resizeBandCanvas();
    chart.timeScale().subscribeVisibleTimeRangeChange(drawBands);
    chart.timeScale().subscribeVisibleLogicalRangeChange(maybeLoadOlder);
    const rafId = requestAnimationFrame(drawBands);
    const enableTimer = window.setTimeout(() => {
      enableBackfillRef.current = true;
    }, 800);

    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
      });
      resizeBandCanvas();
      drawBands();
    });
    ro.observe(wrapper);

    return () => {
      window.clearTimeout(enableTimer);
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(drawBands);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(maybeLoadOlder);
      chart.remove();
      chartRef.current = null;
      candlesRef.current = null;
      volumeRef.current = null;
      ema9Ref.current = null;
      ema20Ref.current = null;
      vwapRef.current = null;
      pmhRef.current = null;
      pmlRef.current = null;
      hodRef.current = null;
      lodRef.current = null;
      drawBandsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    const volume = volumeRef.current;
    const ema9Line = ema9Ref.current;
    const ema20Line = ema20Ref.current;
    const vwapLine = vwapRef.current;
    const pmhLine = pmhRef.current;
    const pmlLine = pmlRef.current;
    const hodLine = hodRef.current;
    const lodLine = lodRef.current;
    if (
      !chart ||
      !candles ||
      !volume ||
      !ema9Line ||
      !ema20Line ||
      !vwapLine ||
      !pmhLine ||
      !pmlLine ||
      !hodLine ||
      !lodLine
    ) {
      return;
    }

    const previousBars = prevBarsRef.current;
    const previousFirstTime = previousBars[0]?.time;
    const prependedCount =
      previousFirstTime == null
        ? 0
        : bars.findIndex((b) => b.time === previousFirstTime);
    const visibleLogicalRange = chart.timeScale().getVisibleLogicalRange();
    const appendedCount =
      previousBars.length > 0 && prependedCount >= 0
        ? bars.length - previousBars.length - prependedCount
        : 0;
    const wasAtRightEdge =
      previousBars.length > 0 &&
      visibleLogicalRange != null &&
      visibleLogicalRange.to >= previousBars.length - 2;

    candles.setData(
      bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    );

    volume.setData(
      bars.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color: b.close >= b.open ? C.volumeUp : C.volumeDown,
      })),
    );

    ema9Line.setData(lineData(bars, indicator.ema9, visibleIndicators.ema9));
    ema20Line.setData(lineData(bars, indicator.ema20, visibleIndicators.ema20));
    vwapLine.setData(lineData(bars, indicator.vwap, visibleIndicators.vwap));
    pmhLine.setData(
      lineData(bars, indicator.pmHigh, visibleIndicators.pmHigh, (v) => v > 0),
    );
    pmlLine.setData(
      lineData(bars, indicator.pmLow, visibleIndicators.pmLow, (v) => v > 0),
    );
    hodLine.setData(
      lineData(
        bars,
        indicator.highOfDay,
        visibleIndicators.highOfDay,
        (v) => v > 0,
      ),
    );
    lodLine.setData(
      lineData(
        bars,
        indicator.lowOfDay,
        visibleIndicators.lowOfDay,
        (v) => v > 0,
      ),
    );

    candles.setMarkers(
      bars
        .map((b, i) =>
          indicator.entries[i]
            ? {
                time: b.time as Time,
                position: "belowBar" as const,
                color: C.marker,
                shape: "arrowUp" as const,
                size: 2,
                text: "BUY",
              }
            : null,
        )
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => (a.time as number) - (b.time as number)),
    );

    if (!initializedRangeRef.current) {
      const latestSession = sessionsRef.current[sessionsRef.current.length - 1];
      if (latestSession) {
        chart.timeScale().setVisibleRange({
          from: latestSession.pmStart as Time,
          to: latestSession.ahEnd as Time,
        });
      }
      initializedRangeRef.current = true;
    } else if (prependedCount > 0 && visibleLogicalRange) {
      chart.timeScale().setVisibleLogicalRange({
        from: visibleLogicalRange.from + prependedCount,
        to: visibleLogicalRange.to + prependedCount,
      });
    } else if (appendedCount > 0 && wasAtRightEdge) {
      chart.timeScale().scrollToRealTime();
    }

    prevBarsRef.current = bars;
    requestAnimationFrame(() => drawBandsRef.current?.());
  }, [bars, indicator, sessions, visibleIndicators]);

  return (
    <div ref={wrapperRef} className="lab-chart-canvas-wrapper">
      <div ref={chartContainerRef} className="lab-chart-canvas-wrapper__chart" />
      <canvas ref={bandCanvasRef} className="lab-chart-session-bands" />
      <div className="lab-chart-indicators" role="toolbar" aria-label="Chart indicators">
        {INDICATORS.map(({ key, label }) => {
          const active = visibleIndicators[key];
          return (
            <button
              key={key}
              type="button"
              className={
                "lab-chart-indicators__button" +
                (active ? " lab-chart-indicators__button--active" : "")
              }
              aria-pressed={active}
              onClick={() =>
                setVisibleIndicators((current) => ({
                  ...current,
                  [key]: !current[key],
                }))
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
