"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@/lib/polygon/types";
import type { Resolution } from "@/lib/polygon/bars";
import type { AlpacaPosition } from "@/types/alpaca";

type StackResolution = Extract<Resolution, "1m" | "5m" | "4h">;

type ChartPayload = {
  ticker: string;
  etDate: string;
  resolution: StackResolution;
  bars: Bar[];
  fetchedAt: string;
};

type ChartState =
  | { status: "loading"; data: Partial<Record<StackResolution, ChartPayload>>; error: null }
  | { status: "ready"; data: Record<StackResolution, ChartPayload>; error: null }
  | { status: "error"; data: Partial<Record<StackResolution, ChartPayload>>; error: string };

type SignalResolution = "1m" | "5m" | "1h" | "4h";

type RvolScannerHit = {
  ticker: string;
  name: string | null;
  resolution: SignalResolution;
  changePct: number;
  priceNow: number;
  dayVolume: number;
  signalTimeEt: string;
  signalUnixSeconds: number;
  signalPrice: number;
  signalRvol: number;
};

type RvolScannerPayload = {
  etDate: string;
  fetchedAt: string;
  hits: RvolScannerHit[];
};

type ScannerState =
  | { status: "loading"; data: RvolScannerPayload | null; error: null }
  | { status: "ready"; data: RvolScannerPayload; error: null }
  | { status: "error"; data: RvolScannerPayload | null; error: string };

type PositionState =
  | { status: "idle"; positions: AlpacaPosition[] }
  | { status: "ready"; positions: AlpacaPosition[] }
  | { status: "unavailable"; positions: AlpacaPosition[] };

type WatchlistTab = "rvol" | "myList";

type IndicatorSet = {
  ema9: number[];
  ema21: number[];
  ema50: number[];
  vwap: number[];
  pmHigh: number | null;
  pmLow: number | null;
};

const RESOLUTIONS: Array<{
  value: StackResolution;
  timeframe: string;
  role: string;
  visibleBars: number;
}> = [
  { value: "1m", timeframe: "1M", role: "TRIGGER", visibleBars: 110 },
  { value: "5m", timeframe: "5M", role: "STRUCTURE", visibleBars: 120 },
  { value: "4h", timeframe: "4H", role: "CONTEXT", visibleBars: 150 },
];

const DEFAULT_MY_LIST = ["NVDA", "TSLA", "AMD", "PLTR", "SMCI"];
const MY_LIST_KEY = "longboard:stack-charts:my-list";
const REFRESH_MS = 60_000;
const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;

const C = {
  bgPanel: "#0F1318",
  bgActive: "#131A22",
  border: "#1F262C",
  textPrimary: "#E8EAEC",
  textSecondary: "#B7C0C8",
  textMuted: "#7A828A",
  textFaint: "#5F6B74",
  up: "#2EBD74",
  down: "#E5484D",
  alert: "#E3B341",
  neutral: "#7E8B96",
  grid: "#171D23",
  ema9: "#9CC4FF",
  ema21: "#5E8FE0",
  ema50: "#7E6BC9",
} as const;

function normalizeTicker(input: string): string | null {
  const ticker = input.trim().replace(/^\$/, "").toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

function money(value: number | string | null | undefined): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: numeric >= 100 ? 2 : 3,
    maximumFractionDigits: numeric >= 100 ? 2 : 3,
  }).format(numeric);
}

function pct(value: number | string | null | undefined): string {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return "--";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`;
}

function compact(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatFetchedAt(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function formatEtTime(date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function etMinutes(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function sessionLabel(date = new Date()): "PRE" | "REG" | "AH" {
  const minutes = etMinutes(date);
  if (minutes >= 240 && minutes < 570) return "PRE";
  if (minutes >= 570 && minutes < 960) return "REG";
  return "AH";
}

function etDateKey(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

function etMinuteOfDay(unixSeconds: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(unixSeconds * 1000));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let index = 0; index < period; index += 1) seed += values[index];
  let previous = seed / period;
  out[period - 1] = previous;
  for (let index = period; index < values.length; index += 1) {
    previous = values[index] * alpha + previous * (1 - alpha);
    out[index] = previous;
  }
  return out;
}

function vwap(bars: Bar[], resetByEtDate: boolean): number[] {
  const out = new Array(bars.length).fill(NaN);
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  let activeDate = "";

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const nextDate = etDateKey(bar.time);
    if (resetByEtDate && nextDate !== activeDate) {
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
      activeDate = nextDate;
    }
    const typical = (bar.high + bar.low + bar.close) / 3;
    cumulativePriceVolume += typical * bar.volume;
    cumulativeVolume += bar.volume;
    out[index] = cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : NaN;
  }

  return out;
}

function premarketLevels(bars: Bar[]): { high: number | null; low: number | null } {
  let high = -Infinity;
  let low = Infinity;
  const lastDate = bars.at(-1) ? etDateKey(bars[bars.length - 1].time) : "";

  for (const bar of bars) {
    if (etDateKey(bar.time) !== lastDate) continue;
    const minute = etMinuteOfDay(bar.time);
    if (minute >= 240 && minute < 570) {
      high = Math.max(high, bar.high);
      low = Math.min(low, bar.low);
    }
  }

  return {
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
  };
}

function indicatorsFor(bars: Bar[], resolution: StackResolution): IndicatorSet {
  const closes = bars.map((bar) => bar.close);
  const levels = resolution === "4h" ? { high: null, low: null } : premarketLevels(bars);
  return {
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    vwap: vwap(bars, resolution !== "4h"),
    pmHigh: levels.high,
    pmLow: levels.low,
  };
}

function lineData(bars: Bar[], values: number[]) {
  return bars
    .map((bar, index) => ({ time: bar.time as Time, value: values[index] }))
    .filter((point) => Number.isFinite(point.value));
}

async function fetchChart(symbol: string, resolution: StackResolution, signal?: AbortSignal) {
  const params = new URLSearchParams({ ticker: symbol, res: resolution });
  const response = await fetch(`/api/command2/chart-bars?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load chart.");
  }
  return json as ChartPayload;
}

async function fetchScanner(signal?: AbortSignal) {
  const params = new URLSearchParams({
    mode: "intraday",
    resolution: "all",
    limit: "20",
  });
  const response = await fetch(`/api/command2/rvol-scanner?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load scanner.");
  }
  return json as RvolScannerPayload;
}

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return {
    clock: formatEtTime(now),
    session: sessionLabel(now),
  };
}

function lastBar(payload: ChartPayload | undefined): Bar | null {
  return payload?.bars.at(-1) ?? null;
}

function firstRegularBar(payload: ChartPayload | undefined): Bar | null {
  if (!payload) return null;
  return payload.bars.find((bar) => etMinuteOfDay(bar.time) >= 570) ?? payload.bars[0] ?? null;
}

function symbolRowsFromScanner(data: RvolScannerPayload | null): RvolScannerHit[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: RvolScannerHit[] = [];
  for (const hit of data.hits) {
    if (seen.has(hit.ticker)) continue;
    seen.add(hit.ticker);
    rows.push(hit);
  }
  return rows.slice(0, 20);
}

function StackChartPanel({
  payload,
  resolution,
  role,
  visibleBars,
  loading,
}: {
  payload: ChartPayload | undefined;
  resolution: StackResolution;
  role: string;
  visibleBars: number;
  loading: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);

  const indicators = useMemo(
    () => indicatorsFor(payload?.bars ?? [], resolution),
    [payload?.bars, resolution],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: C.bgPanel },
        textColor: C.textFaint,
        fontFamily: "IBM Plex Mono, ui-monospace, Menlo, monospace",
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: C.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: C.neutral, width: 1, style: LineStyle.Dotted },
        horzLine: { color: C.neutral, width: 1, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: C.border,
        scaleMargins: { top: 0.08, bottom: 0.2 },
        minimumWidth: 58,
      },
      timeScale: {
        visible: false,
        borderColor: C.border,
      },
      handleScale: true,
      handleScroll: true,
    });

    chartRef.current = chart;
    candleRef.current = chart.addCandlestickSeries({
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
      priceLineColor: C.up,
    });
    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeRef.current.priceScale().applyOptions({
      scaleMargins: { top: 0.86, bottom: 0 },
    });
    ema9Ref.current = chart.addLineSeries({
      color: C.ema9,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema21Ref.current = chart.addLineSeries({
      color: C.ema21,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema50Ref.current = chart.addLineSeries({
      color: C.ema50,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    vwapRef.current = chart.addLineSeries({
      color: C.alert,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const observer = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      ema9Ref.current = null;
      ema21Ref.current = null;
      ema50Ref.current = null;
      vwapRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    const volume = volumeRef.current;
    const ema9Line = ema9Ref.current;
    const ema21Line = ema21Ref.current;
    const ema50Line = ema50Ref.current;
    const vwapLine = vwapRef.current;
    if (!payload || !chart || !candles || !volume || !ema9Line || !ema21Line || !ema50Line || !vwapLine) {
      return;
    }

    candles.setData(
      payload.bars.map((bar) => ({
        time: bar.time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );
    volume.setData(
      payload.bars.map(
        (bar): HistogramData => ({
          time: bar.time as Time,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(46, 189, 116, 0.38)" : "rgba(229, 72, 77, 0.38)",
        }),
      ),
    );
    ema9Line.setData(lineData(payload.bars, indicators.ema9));
    ema21Line.setData(lineData(payload.bars, indicators.ema21));
    ema50Line.setData(lineData(payload.bars, indicators.ema50));
    vwapLine.setData(lineData(payload.bars, indicators.vwap));

    for (const line of priceLinesRef.current) {
      candles.removePriceLine(line);
    }
    priceLinesRef.current = [];

    if (resolution !== "4h") {
      if (indicators.pmHigh) {
        priceLinesRef.current.push(candles.createPriceLine({
          price: indicators.pmHigh,
          color: C.neutral,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `PM HIGH ${indicators.pmHigh.toFixed(2)}`,
        }));
      }
      if (indicators.pmLow) {
        priceLinesRef.current.push(candles.createPriceLine({
          price: indicators.pmLow,
          color: C.neutral,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `PM LOW ${indicators.pmLow.toFixed(2)}`,
        }));
      }
    }

    if (payload.bars.length > 0) {
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, payload.bars.length - visibleBars),
        to: payload.bars.length + 4,
      });
    }
  }, [indicators, payload, resolution, visibleBars]);

  return (
    <section className={`stack-chart stack-chart--${resolution}`}>
      <header className="stack-chart__header">
        <div className="stack-chart__title">
          <strong>{resolution.toUpperCase()}</strong>
          <span>{role}</span>
        </div>
        <div className="stack-legend" aria-label={`${resolution} indicators`}>
          <span><i className="dot dot--vwap" />VWAP</span>
          <span><i className="dot dot--ema9" />EMA 9</span>
          <span><i className="dot dot--ema21" />EMA 21</span>
          <span><i className="dot dot--ema50" />EMA 50</span>
          {resolution !== "4h" && <span><i className="dot dot--pm" />PM</span>}
        </div>
      </header>
      <div className="stack-chart__surface">
        <div ref={containerRef} className="stack-chart__canvas" />
        {loading && (
          <div className="stack-chart__skeleton" role="status">
            LOADING {resolution.toUpperCase()}
          </div>
        )}
        {!loading && payload && payload.bars.length === 0 && (
          <div className="stack-chart__skeleton" role="status">
            NO BARS
          </div>
        )}
      </div>
    </section>
  );
}

export default function StackChartsWorkspace({ initialSymbol }: { initialSymbol: string }) {
  const router = useRouter();
  const live = useLiveClock();
  const [activeSymbol, setActiveSymbol] = useState(initialSymbol);
  const [symbolInput, setSymbolInput] = useState("");
  const [watchlistTab, setWatchlistTab] = useState<WatchlistTab>("rvol");
  const [myList, setMyList] = useState<string[]>(DEFAULT_MY_LIST);
  const [charts, setCharts] = useState<ChartState>({
    status: "loading",
    data: {},
    error: null,
  });
  const [scanner, setScanner] = useState<ScannerState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [positions, setPositions] = useState<PositionState>({
    status: "idle",
    positions: [],
  });

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MY_LIST_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const symbols = parsed.filter((item) => typeof item === "string").map((item) => normalizeTicker(item)).filter(Boolean) as string[];
        if (symbols.length > 0) setMyList(Array.from(new Set(symbols)).slice(0, 30));
      }
    } catch {
      setMyList(DEFAULT_MY_LIST);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MY_LIST_KEY, JSON.stringify(myList));
  }, [myList]);

  useEffect(() => {
    setActiveSymbol(initialSymbol);
  }, [initialSymbol]);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    async function load(showLoading: boolean) {
      controller?.abort();
      controller = new AbortController();
      if (showLoading) {
        setCharts((current) => ({ status: "loading", data: current.data, error: null }));
      }
      try {
        const rows = await Promise.all(
          RESOLUTIONS.map(async (item) => [item.value, await fetchChart(activeSymbol, item.value, controller?.signal)] as const),
        );
        if (cancelled) return;
        setCharts({
          status: "ready",
          data: Object.fromEntries(rows) as Record<StackResolution, ChartPayload>,
          error: null,
        });
      } catch (error) {
        if (cancelled || controller?.signal.aborted) return;
        setCharts((current) => ({
          status: "error",
          data: current.data,
          error: error instanceof Error ? error.message : "Unable to load charts.",
        }));
      }
    }

    void load(true);
    const id = window.setInterval(() => void load(false), REFRESH_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(id);
    };
  }, [activeSymbol]);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    async function load(showLoading: boolean) {
      controller?.abort();
      controller = new AbortController();
      if (showLoading) {
        setScanner((current) => ({ status: "loading", data: current.data, error: null }));
      }
      try {
        const data = await fetchScanner(controller.signal);
        if (!cancelled) setScanner({ status: "ready", data, error: null });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setScanner((current) => ({
          status: "error",
          data: current.data,
          error: error instanceof Error ? error.message : "Scanner unavailable.",
        }));
      }
    }

    void load(true);
    const id = window.setInterval(() => void load(false), REFRESH_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPositions() {
      try {
        const response = await fetch("/api/alpaca/positions", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setPositions({ status: "unavailable", positions: [] });
          return;
        }
        const data = (await response.json()) as AlpacaPosition[];
        if (!cancelled) setPositions({ status: "ready", positions: Array.isArray(data) ? data : [] });
      } catch {
        if (!cancelled) setPositions({ status: "unavailable", positions: [] });
      }
    }
    void loadPositions();
    return () => {
      cancelled = true;
    };
  }, []);

  const scannerRows = useMemo(() => symbolRowsFromScanner(scanner.data), [scanner.data]);
  const activeScannerHit = useMemo(
    () => scannerRows.find((row) => row.ticker === activeSymbol) ?? null,
    [activeSymbol, scannerRows],
  );
  const activePosition = useMemo(
    () => positions.positions.find((position) => position.symbol.toUpperCase() === activeSymbol) ?? null,
    [activeSymbol, positions.positions],
  );
  const primaryPayload = charts.data["1m"];
  const activeLastBar = lastBar(primaryPayload);
  const activeFirstBar = firstRegularBar(primaryPayload);
  const lastPrice = activeScannerHit?.priceNow ?? activeLastBar?.close ?? Number(activePosition?.current_price);
  const changePct =
    activeScannerHit?.changePct ??
    (activeLastBar && activeFirstBar ? ((activeLastBar.close - activeFirstBar.close) / activeFirstBar.close) * 100 : null);
  const activeCompany = activeScannerHit?.name ?? "LONGBOARD STACK";
  const globalAlertCount = scannerRows.length;

  function selectSymbol(symbol: string) {
    const normalized = normalizeTicker(symbol);
    if (!normalized) return;
    setActiveSymbol(normalized);
    router.push(`/charts/${encodeURIComponent(normalized)}`, { scroll: false });
  }

  function submitSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeTicker(symbolInput);
    if (!normalized) return;
    setSymbolInput("");
    selectSymbol(normalized);
  }

  function addMyListSymbol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeTicker(symbolInput);
    if (!normalized) return;
    setMyList((current) => Array.from(new Set([normalized, ...current])).slice(0, 30));
    setWatchlistTab("myList");
    setSymbolInput("");
    selectSymbol(normalized);
  }

  function removeMyListSymbol(symbol: string) {
    setMyList((current) => current.filter((item) => item !== symbol));
  }

  const positionPnl = activePosition ? Number(activePosition.unrealized_pl) : null;
  const positionPnlPct = activePosition ? Number(activePosition.unrealized_plpc) * 100 : null;

  return (
    <main className="stack-page">
      <div className="stack-shell">
        <header className="stack-topbar">
          <div className="stack-brand">
            <a href="/command2" aria-label="Longboard command center" className="stack-brand__mark">L</a>
            <div className="stack-symbol">
              <strong>{activeSymbol}</strong>
              <span>{activeCompany}</span>
            </div>
            <div className="stack-quote">
              <b>{money(lastPrice)}</b>
              <span className={Number(changePct) >= 0 ? "is-up" : "is-down"}>{pct(changePct)}</span>
              {activeScannerHit && <em>{compact(activeScannerHit.dayVolume)} VOL</em>}
            </div>
          </div>
          <form className="stack-search" onSubmit={submitSymbol}>
            <button type="submit" aria-label="Load chart symbol">⌕</button>
            <input
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value)}
              placeholder="SYMBOL"
              aria-label="Chart symbol"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </form>
          <div className="stack-status">
            <span className={globalAlertCount > 0 ? "stack-alert-count is-armed" : "stack-alert-count"}>
              {globalAlertCount} ALERTS
            </span>
            <span>{live.session}</span>
            <span className="stack-live"><i />{charts.status === "error" ? "RECONNECTING" : live.clock}</span>
          </div>
        </header>

        <aside className="stack-rail">
          <section className="stack-rail__panel stack-watchlist">
            <div className="stack-tabs" role="tablist" aria-label="Watchlist source">
              <button
                type="button"
                role="tab"
                aria-selected={watchlistTab === "rvol"}
                onClick={() => setWatchlistTab("rvol")}
              >
                RVOL SCANNER
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={watchlistTab === "myList"}
                onClick={() => setWatchlistTab("myList")}
              >
                MY LIST
              </button>
            </div>

            {watchlistTab === "rvol" ? (
              <div className="stack-watchlist__rows">
                {scannerRows.map((row, index) => (
                  <button
                    key={`${row.ticker}-${row.resolution}-${row.signalUnixSeconds}`}
                    type="button"
                    className={row.ticker === activeSymbol ? "stack-watch-row is-active" : "stack-watch-row"}
                    onClick={() => selectSymbol(row.ticker)}
                  >
                    <span className="rank">{index + 1}</span>
                    <span className="ticker">
                      <b>{row.ticker}</b>
                      {index === 0 && <em>TOP</em>}
                    </span>
                    <span className="price">
                      <b>{money(row.priceNow)}</b>
                      <em>{pct(row.changePct)}</em>
                    </span>
                  </button>
                ))}
                {scanner.status === "loading" && <p className="stack-rail-message">LOADING SCANNER</p>}
                {scanner.status === "error" && <p className="stack-rail-message">{scanner.error}</p>}
                {scanner.status === "ready" && scannerRows.length === 0 && <p className="stack-rail-message">NO SIGNALS</p>}
              </div>
            ) : (
              <div className="stack-watchlist__rows">
                <form className="stack-list-add" onSubmit={addMyListSymbol}>
                  <input
                    value={symbolInput}
                    onChange={(event) => setSymbolInput(event.target.value)}
                    placeholder="ADD"
                    aria-label="Add symbol"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                  <button type="submit" aria-label="Add symbol">+</button>
                </form>
                {myList.map((symbol, index) => (
                  <div
                    key={symbol}
                    className={symbol === activeSymbol ? "stack-watch-row stack-watch-row--managed is-active" : "stack-watch-row stack-watch-row--managed"}
                  >
                    <button
                      type="button"
                      className="stack-watch-main"
                      onClick={() => selectSymbol(symbol)}
                    >
                      <span className="rank">{index + 1}</span>
                      <span className="ticker"><b>{symbol}</b></span>
                    </button>
                    <button
                      type="button"
                      className="stack-remove"
                      aria-label={`Remove ${symbol}`}
                      onClick={() => removeMyListSymbol(symbol)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="stack-rail__panel stack-alerts">
            <h2>ALERTS</h2>
            {activeScannerHit ? (
              <div className="stack-alert-row is-triggered">
                <i />
                <span>
                  <b>RVOL HIT {activeScannerHit.signalTimeEt}</b>
                  <em>{activeScannerHit.resolution} / {activeScannerHit.signalRvol.toFixed(1)}X</em>
                </span>
                <strong>{money(activeScannerHit.signalPrice)}</strong>
              </div>
            ) : (
              <p className="stack-rail-message">NO ACTIVE ALERTS</p>
            )}
          </section>

          {activePosition && (
            <section className="stack-rail__panel stack-position">
              <h2>POSITION</h2>
              <p>{activePosition.side.toUpperCase()} {activePosition.qty} @ {money(activePosition.avg_entry_price)}</p>
              <strong className={Number(positionPnl) >= 0 ? "is-up" : "is-down"}>{money(positionPnl)}</strong>
              <span className={Number(positionPnl) >= 0 ? "is-up" : "is-down"}>{pct(positionPnlPct)}</span>
              <small>DAY {money(activePosition.unrealized_intraday_pl)} / R --</small>
            </section>
          )}
        </aside>

        <section className="stack-grid" aria-label={`${activeSymbol} chart stack`}>
          {charts.status === "error" && <div className="stack-error">{charts.error}</div>}
          {RESOLUTIONS.map((item) => (
            <StackChartPanel
              key={`${activeSymbol}-${item.value}`}
              payload={charts.data[item.value]}
              resolution={item.value}
              role={item.role}
              visibleBars={item.visibleBars}
              loading={charts.status === "loading" && !charts.data[item.value]}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
