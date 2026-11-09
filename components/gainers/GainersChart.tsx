"use client";
import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, IPriceLine, Time, UTCTimestamp } from "lightweight-charts";
import type { GainersBar, GainersLine, GainersMissedPivot } from "@/lib/chatGainersPages";

type Props = {
  className: string;
  label: string;
  bars: GainersBar[];
  sma: GainersLine[];
  vwap: GainersLine[];
  signal: number;
  pivot: number | null;
  pivotTitle: string;
  missed: GainersMissedPivot[];
};
const at = (seconds: number) => seconds as UTCTimestamp as Time;
// Bars carry Eastern wall-clock time, so this is true outside 9:30 AM to 4 PM.
const extended = (seconds: number) => {
  const minute = Math.floor(seconds / 60) % 1440;
  return minute < 570 || minute >= 960;
};

/** #340: one 2-minute chart. The chart library loads only here, so nothing else in chat pays for it. */
export default function GainersChart({ className, label, bars, sma, vwap, signal, pivot, pivotTitle, missed }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let cancelled = false;
    let cleanup = () => {};
    void import("lightweight-charts").then(({ createChart, ColorType }) => {
      if (cancelled) return;
      const chart: IChartApi = createChart(element, {
        autoSize: true,
        timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 2, minBarSpacing: 0.1 },
        handleScale: { axisPressedMouseMove: false },
        rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.24 } },
      });
      const shade = chart.addHistogramSeries({ priceScaleId: "sess", priceLineVisible: false, lastValueVisible: false });
      chart.priceScale("sess").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
      const volume = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
      const lineOptions = { lineWidth: 2 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      const smaLine = chart.addLineSeries(lineOptions);
      const vwapLine = chart.addLineSeries(lineOptions);
      const small = bars[0][1] < 10;
      const candle: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
        priceLineVisible: false,
        priceFormat: { type: "price", precision: small ? 3 : 2, minMove: small ? 0.001 : 0.01 },
      });
      let lines: IPriceLine[] = [];
      const paint = () => {
        const styles = getComputedStyle(element);
        const token = (name: string) => styles.getPropertyValue(name).trim();
        const up = token("--up"),
          down = token("--down");
        chart.applyOptions({
          layout: {
            background: { type: ColorType.Solid, color: token("--panel") },
            textColor: token("--dim"),
            fontFamily: `${token("--gd-mono") || "IBM Plex Mono"}, monospace`,
          },
          grid: { vertLines: { visible: false }, horzLines: { color: token("--line") } },
          rightPriceScale: { borderColor: token("--line") },
          timeScale: { borderColor: token("--line") },
        });
        candle.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
        candle.setData(bars.map((b) => ({ time: at(b[0]), open: b[1], high: b[2], low: b[3], close: b[4] })));
        volume.setData(bars.map((b) => ({ time: at(b[0]), value: b[5], color: `${b[4] >= b[1] ? up : down}66` })));
        shade.setData(bars.map((b) => ({ time: at(b[0]), value: 1, color: extended(b[0]) ? token("--shade") : "transparent" })));
        smaLine.applyOptions({ color: token("--sma") });
        vwapLine.applyOptions({ color: token("--vwap") });
        smaLine.setData(sma.map(([time, value]) => ({ time: at(time), value })));
        vwapLine.setData(vwap.map(([time, value]) => ({ time: at(time), value })));
        lines.forEach((line) => candle.removePriceLine(line));
        lines = [];
        if (pivot !== null)
          lines.push(candle.createPriceLine({ price: pivot, color: token("--fg"), lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: pivotTitle }));
        for (const item of missed)
          lines.push(candle.createPriceLine({ price: item.price, color: token("--missed"), lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `Missed ${item.month}` }));
        const candleTime = bars.reduce((found, b) => (b[0] <= signal ? b[0] : found), bars[0][0]);
        candle.setMarkers([{ time: at(candleTime), position: "belowBar", color: token("--alert"), shape: "arrowUp", size: 1.4 }]);
      };
      paint();
      const fit = () => chart.timeScale().fitContent();
      fit();
      const resize = new ResizeObserver(() => requestAnimationFrame(fit));
      resize.observe(element);
      const scheme = matchMedia("(prefers-color-scheme: dark)");
      scheme.addEventListener("change", paint);
      // #343: redraw when the page's theme changes, keeping any zoom.
      const page = element.closest("[data-gainers-page]");
      const themeWatch = new MutationObserver(paint);
      if (page) themeWatch.observe(page, { attributes: true, attributeFilter: ["data-gainers-theme"] });
      cleanup = () => {
        themeWatch.disconnect();
        resize.disconnect();
        scheme.removeEventListener("change", paint);
        chart.remove();
      };
    });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [bars, sma, vwap, signal, pivot, pivotTitle, missed]);
  return <div ref={box} className={className} role="img" aria-label={label} data-gainers-chart />;
}
