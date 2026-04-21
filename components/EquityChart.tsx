"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, LineStyle } from "lightweight-charts";
import type { IChartApi, ISeriesApi, Time, UTCTimestamp } from "lightweight-charts";

export type EquityPoint = { snapshot_at: string; equity: number };

type Props = {
  snapshots: EquityPoint[];
  /** Sign of the overall change — drives line color (accent vs danger).
   *  null means neutral / no data yet, fall back to accent. */
  changeSign: 1 | -1 | 0 | null;
  height?: number;
};

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function EquityChart({ snapshots, changeSign, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  // Create chart once. Keep the instance alive across data updates to avoid
  // flicker and to let lightweight-charts handle incremental updates.
  useEffect(() => {
    if (!containerRef.current) return;

    const text = readVar("--text-secondary", "#7a8a82");
    const border = readVar("--border", "#1a2420");
    const surface = readVar("--surface", "#0f1412");
    // lightweight-charts renders axis labels to canvas — it needs a
    // resolved family string, not a raw CSS var reference. readVar
    // evaluates against <html> (Statement / Dark / Light all resolve
    // --font-labels to mono), with a defensive fallback.
    const axisFont = readVar("--font-labels", "'IBM Plex Mono', monospace");

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: surface },
        textColor: text,
        fontFamily: axisFont,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: border, style: LineStyle.Dotted },
        horzLines: { color: border, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false },
      handleScale: false,
      handleScroll: false,
      crosshair: {
        vertLine: { color: text, width: 1, style: LineStyle.Dotted, labelBackgroundColor: surface },
        horzLine: { color: text, width: 1, style: LineStyle.Dotted, labelBackgroundColor: surface },
      },
    });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  // Rebuild the series on data/color change. Removing + re-adding is simpler
  // than mutating color on the existing series API.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const accent = readVar("--accent", "#00ff88");
    const danger = readVar("--danger", "#ff4466");
    const color = changeSign === -1 ? danger : accent;

    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    const series = chart.addAreaSeries({
      lineColor: color,
      topColor: color + "40",
      bottomColor: color + "00",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    seriesRef.current = series;

    // lightweight-charts wants ascending, unique timestamps. Snapshots come
    // in sorted from the API, but de-dupe defensively — same-second writes
    // (live point landing on the snapshot second) would otherwise throw.
    const seen = new Set<number>();
    const data = snapshots
      .map((s) => ({ time: (Math.floor(new Date(s.snapshot_at).getTime() / 1000)) as UTCTimestamp, value: s.equity }))
      .filter((p) => {
        if (seen.has(p.time as number)) return false;
        seen.add(p.time as number);
        return true;
      })
      .sort((a, b) => (a.time as number) - (b.time as number)) as Array<{ time: Time; value: number }>;

    series.setData(data);
    if (data.length > 0) chart.timeScale().fitContent();
  }, [snapshots, changeSign]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
