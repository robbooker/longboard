"use client";

import { ChangeEvent, DragEvent, FormEvent, ReactNode, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@/lib/polygon/types";
import type { Resolution } from "@/lib/polygon/bars";
import type { GhostPivot } from "@/lib/charts/ghostPivot";
import type { AlpacaPosition } from "@/types/alpaca";
import type { GainersData, PolygonTickerSnapshot } from "@/types/polygon";
import {
  DEFAULT_ROB_TOP_STOCKS,
  ROB_TOP_STOCKS_EDITOR_EMAIL,
  normalizeRobTopStocks,
  parseRobTopStocksText,
} from "@/lib/charts/robTopStocks";

type StackResolution = Extract<Resolution, "1m" | "5m" | "4h">;

type ChartPayload = {
  ticker: string;
  etDate: string;
  resolution: StackResolution;
  bars: Bar[];
  ghostPivot: GhostPivot | null;
  monthlyPivots?: MonthlyPivotEnrichment | null;
  fetchedAt: string;
};

type ChartState =
  | { status: "loading"; data: Partial<Record<StackResolution, ChartPayload>>; error: null }
  | { status: "ready"; data: Record<StackResolution, ChartPayload>; error: null }
  | { status: "error"; data: Partial<Record<StackResolution, ChartPayload>>; error: string };

type SignalResolution = "1m" | "5m" | "1h" | "4h";
type ScannerMode = "intraday" | "longTerm";

type MonthlyPivotTarget = {
  price: number;
  sourceMonth: string;
  sourceMonthLabel: string;
  activeMonth: string;
  activeMonthLabel: string;
  activeFromDate: string;
  lastCheckedDate: string;
};

type MonthlyPivotEnrichment = {
  monthlyPivotTarget: MonthlyPivotTarget | null;
  monthlyPivotCount: number;
  monthlyPivotsAbovePrice: MonthlyPivotTarget[];
  monthlyPivotError: string | null;
};

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
  breakoutLevel?: number;
  breakoutMode?: "premarketHigh" | "twoWeekHigh" | "monthToDateHigh";
  monthlyPivotTarget?: MonthlyPivotTarget | null;
  monthlyPivotCount?: number;
  monthlyPivotsAbovePrice?: MonthlyPivotTarget[];
  monthlyPivotError?: string | null;
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

type TopGainersState =
  | { status: "loading"; data: GainersData | null; error: null }
  | { status: "ready"; data: GainersData; error: null }
  | { status: "error"; data: GainersData | null; error: string };

type RobTopStocksState =
  | { status: "loading"; symbols: string[]; error: null; updatedAt: string | null; updatedByEmail: string | null }
  | { status: "ready"; symbols: string[]; error: null; updatedAt: string | null; updatedByEmail: string | null }
  | { status: "error"; symbols: string[]; error: string; updatedAt: string | null; updatedByEmail: string | null };

type ViewerState =
  | { status: "loading"; email: null }
  | { status: "ready"; email: string | null };

type PositionState =
  | { status: "idle"; positions: AlpacaPosition[] }
  | { status: "ready"; positions: AlpacaPosition[] }
  | { status: "unavailable"; positions: AlpacaPosition[] };

type WatchlistTab = "rvol" | "robTop" | "topGainers" | "myList";
type StackChartTheme = "dark" | "light";
type ChartViewMode = "stack" | "quad" | "single";
type RvolSortMode = "recent" | "move";
type TopGainersSortMode = "updated" | "gain";
type DrawingTool = "pan" | "crosshair" | "arrow" | "text" | "erase";
type PriceAlertDirection = "above" | "below";
type PriceAlertStatus = "active" | "triggered";

type ChartAnchor = {
  x: number;
  y: number;
  time?: number;
  price?: number;
};

type ChartAnnotationBase = {
  id: string;
  symbol: string;
  resolution: StackResolution;
};

type ChartArrowAnnotation = ChartAnnotationBase & {
  type: "arrow";
  start: ChartAnchor;
  end: ChartAnchor;
};

type ChartTextAnnotation = ChartAnnotationBase & {
  type: "text";
  at: ChartAnchor;
  text: string;
};

type ChartAnnotation = ChartArrowAnnotation | ChartTextAnnotation;

type PriceAlert = {
  id: string;
  symbol: string;
  price: number;
  direction: PriceAlertDirection;
  status: PriceAlertStatus;
  createdAt: string;
  triggeredAt?: string;
  triggerPrice?: number;
};

type UserWatchlist = {
  id: string;
  name: string;
  symbols: string[];
};

type ChartSlot = {
  id: string;
  symbol: string;
  resolution: StackResolution;
};

type SingleChartState =
  | { status: "loading"; data: ChartPayload | undefined; error: null }
  | { status: "ready"; data: ChartPayload; error: null }
  | { status: "error"; data: ChartPayload | undefined; error: string };

type CompanyFundamentals = {
  ticker: string;
  fetchedAt: string;
  marketCap: number | null;
  floatOutstanding: number | null;
  estimatedCash: number | null;
  cashRemainingMonths: number | null;
  cashNeed: string | null;
  cashNeedDesc: string | null;
  overallOfferingRisk: string | null;
  notes: string | null;
  errors: string[];
};

type CompanyNewsItem = {
  id: string;
  ticker: string;
  published_utc?: string;
  title: string;
  source?: string;
  url?: string;
};

type CompanySnapshot = {
  ticker: {
    marketCap: number | null;
    companyName: string | null;
    averageVolume30d?: number | null;
  };
  fetchedAt: string;
};

type CompanyInfoState =
  | { status: "loading"; fundamentals: CompanyFundamentals | null; snapshot: CompanySnapshot | null; news: CompanyNewsItem | null; error: null }
  | { status: "ready"; fundamentals: CompanyFundamentals | null; snapshot: CompanySnapshot | null; news: CompanyNewsItem | null; error: null }
  | { status: "error"; fundamentals: CompanyFundamentals | null; snapshot: CompanySnapshot | null; news: CompanyNewsItem | null; error: string };

type IndicatorSet = {
  ema9: number[];
  ema21: number[];
  ema50: number[];
  vwap: number[];
  pmHigh: number | null;
  pmLow: number | null;
  fractals: WilliamsFractal[];
};

type WilliamsFractal = {
  time: number;
  price: number;
  kind: "high" | "low";
};

type CandleInspection = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePct: number;
  range: number;
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
const DEFAULT_WATCHLIST_ID = "main";
const DEFAULT_WATCHLISTS: UserWatchlist[] = [
  { id: DEFAULT_WATCHLIST_ID, name: "Main", symbols: DEFAULT_MY_LIST },
];
const DEFAULT_QUAD_SLOTS: ChartSlot[] = [
  { id: "slot-1", symbol: "NVDA", resolution: "5m" },
  { id: "slot-2", symbol: "TSLA", resolution: "5m" },
  { id: "slot-3", symbol: "AMD", resolution: "5m" },
  { id: "slot-4", symbol: "PLTR", resolution: "5m" },
];
const EMPTY_SIGNAL_HITS: RvolScannerHit[] = [];
const EMPTY_MONTHLY_PIVOTS: MonthlyPivotTarget[] = [];
const MY_LIST_KEY = "longboard:stack-charts:my-list";
const WATCHLISTS_KEY = "longboard:stack-charts:watchlists";
const ACTIVE_WATCHLIST_KEY = "longboard:stack-charts:active-watchlist";
const WATCHLIST_TAB_KEY = "longboard:stack-charts:watchlist-tab";
const THEME_KEY = "longboard:stack-charts:theme";
const VIEW_MODE_KEY = "longboard:stack-charts:view";
const SHOW_RECENT_HIGHS_KEY = "longboard:stack-charts:show-recent-highs";
const SHOW_FRACTALS_KEY = "longboard:stack-charts:show-fractals";
const SHOW_GHOST_PIVOT_KEY = "longboard:stack-charts:show-ghost-pivot";
const QUAD_SLOTS_KEY = "longboard:stack-charts:quad-slots";
const SINGLE_RESOLUTION_KEY = "longboard:stack-charts:single-resolution";
const RVOL_SORT_KEY = "longboard:stack-charts:rvol-sort";
const TOP_GAINERS_SORT_KEY = "longboard:stack-charts:top-gainers-sort";
const RVOL_SOUND_KEY = "longboard:stack-charts:rvol-sound";
const ANNOTATIONS_KEY = "longboard:stack-charts:annotations";
const PRICE_ALERTS_KEY = "longboard:stack-charts:price-alerts";
const TIME_SCALE_RANGE_KEY = "longboard:stack-charts:time-scale-range";
const REFRESH_MS = 60_000;
const CHART_RIGHT_OFFSET = 4;
const DEFAULT_PRICE_SCALE_MARGINS = { top: 0.08, bottom: 0.2 } as const;
const MIN_STORED_RANGE_SPAN = 24;
const MAX_STORED_RANGE_SPAN = 904;
const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;

const STACK_CHART_PALETTES = {
  dark: {
    bgPanel: "#0F1318",
    border: "#1F262C",
    textFaint: "#5F6B74",
    up: "#2EBD74",
    down: "#E5484D",
    alert: "#E3B341",
    ghost: "#4DD0E1",
    neutral: "#7E8B96",
    grid: "#171D23",
    ema9: "#9CC4FF",
    ema21: "#5E8FE0",
    ema50: "#7E6BC9",
    fractalHigh: "#FF8A65",
    fractalLow: "#4DD0E1",
    volumeUp: "rgba(46, 189, 116, 0.38)",
    volumeDown: "rgba(229, 72, 77, 0.38)",
  },
  light: {
    bgPanel: "#F8FAF8",
    border: "#D8DDD8",
    textFaint: "#708076",
    up: "#168455",
    down: "#C93D46",
    alert: "#B98212",
    ghost: "#008C9E",
    neutral: "#7B8790",
    grid: "#E6EBE7",
    ema9: "#2F75BA",
    ema21: "#6A97D6",
    ema50: "#7861C9",
    fractalHigh: "#D85C35",
    fractalLow: "#17849A",
    volumeUp: "rgba(22, 132, 85, 0.32)",
    volumeDown: "rgba(201, 61, 70, 0.3)",
  },
} as const;

type StackChartPalette = (typeof STACK_CHART_PALETTES)[StackChartTheme];

function normalizeTicker(input: string): string | null {
  const ticker = input.trim().replace(/^\$/, "").toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

function uniqueSymbols(symbols: string[], limit = 120): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const symbol of symbols) {
    const ticker = normalizeTicker(symbol);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
    if (out.length >= limit) break;
  }
  return out;
}

function parseTickerCsv(text: string): string[] {
  return uniqueSymbols(
    text
      .split(/[\s,;|]+/)
      .map((cell) => cell.replace(/^["']|["']$/g, ""))
      .filter((cell) => !/^(ticker|tickers|symbol|symbols)$/i.test(cell)),
  );
}

function normalizeWatchlists(value: unknown): UserWatchlist[] | null {
  if (!Array.isArray(value)) return null;
  const out: UserWatchlist[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<UserWatchlist>;
    if (typeof record.id !== "string" || typeof record.name !== "string") continue;
    const id = record.id.trim();
    const name = record.name.trim();
    const symbols = uniqueSymbols(Array.isArray(record.symbols) ? record.symbols : []);
    if (!id || !name || seenIds.has(id)) continue;
    seenIds.add(id);
    out.push({ id, name, symbols });
  }
  return out.length > 0 ? out : null;
}

function normalizeChartSlots(value: unknown, fallbackSymbol: string): ChartSlot[] {
  const fallback = DEFAULT_QUAD_SLOTS.map((slot, index) => ({
    ...slot,
    symbol: index === 0 ? fallbackSymbol : slot.symbol,
  }));
  if (!Array.isArray(value)) return fallback;
  const slots = value
    .slice(0, 4)
    .map((item, index): ChartSlot | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<ChartSlot>;
      const symbol = typeof record.symbol === "string" ? normalizeTicker(record.symbol) : null;
      const resolution = record.resolution === "1m" || record.resolution === "5m" || record.resolution === "4h"
        ? record.resolution
        : "5m";
      return {
        id: typeof record.id === "string" && record.id.trim() ? record.id : `slot-${index + 1}`,
        symbol: symbol ?? fallback[index]?.symbol ?? DEFAULT_MY_LIST[index] ?? fallbackSymbol,
        resolution,
      };
    })
    .filter((slot): slot is ChartSlot => slot !== null);
  while (slots.length < 4) {
    slots.push(fallback[slots.length]);
  }
  return slots;
}

function quadSlotRequestKey(slot: ChartSlot): string {
  return `${slot.symbol}:${slot.resolution}`;
}

function chartAnnotationKey(symbol: string, resolution: StackResolution): string {
  return `${symbol}:${resolution}`;
}

function chartTimeScaleStorageKey(symbol: string, resolution: StackResolution): string {
  const ticker = (normalizeTicker(symbol) ?? symbol.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "")) || "CHART";
  return `${TIME_SCALE_RANGE_KEY}:${ticker}:${resolution}`;
}

function normalizeVisibleRangeSpan(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(MAX_STORED_RANGE_SPAN, Math.max(MIN_STORED_RANGE_SPAN, Number(value.toFixed(2))));
}

function readStoredVisibleRangeSpan(key: string, fallback: number): number {
  try {
    return normalizeVisibleRangeSpan(Number(window.localStorage.getItem(key)), fallback);
  } catch {
    return fallback;
  }
}

function writeStoredVisibleRangeSpan(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(normalizeVisibleRangeSpan(value, value)));
  } catch {
    // Some privacy modes can block localStorage writes.
  }
}

function normalizeAnchor(value: unknown): ChartAnchor | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ChartAnchor>;
  if (typeof record.x !== "number" || !Number.isFinite(record.x) || typeof record.y !== "number" || !Number.isFinite(record.y)) {
    return null;
  }
  const anchor: ChartAnchor = {
    x: Math.min(1, Math.max(0, record.x)),
    y: Math.min(1, Math.max(0, record.y)),
  };
  if (typeof record.time === "number" && Number.isFinite(record.time)) anchor.time = record.time;
  if (typeof record.price === "number" && Number.isFinite(record.price)) anchor.price = record.price;
  return anchor;
}

function normalizeAnnotations(value: unknown): ChartAnnotation[] {
  if (!Array.isArray(value)) return [];
  const out: ChartAnnotation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<ChartAnnotation>;
    const symbol = typeof record.symbol === "string" ? normalizeTicker(record.symbol) : null;
    const resolution = record.resolution === "1m" || record.resolution === "5m" || record.resolution === "4h"
      ? record.resolution
      : null;
    const id = typeof record.id === "string" && record.id.trim() ? record.id : "";
    if (!id || !symbol || !resolution) continue;
    if (record.type === "arrow") {
      const start = normalizeAnchor(record.start);
      const end = normalizeAnchor(record.end);
      if (start && end) out.push({ id, symbol, resolution, type: "arrow", start, end });
    }
    if (record.type === "text") {
      const at = normalizeAnchor(record.at);
      const text = typeof record.text === "string" ? record.text.trim().slice(0, 64) : "";
      if (at && text) out.push({ id, symbol, resolution, type: "text", at, text });
    }
  }
  return out.slice(-500);
}

function normalizePriceAlerts(value: unknown): PriceAlert[] {
  if (!Array.isArray(value)) return [];
  const out: PriceAlert[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<PriceAlert>;
    const symbol = typeof record.symbol === "string" ? normalizeTicker(record.symbol) : null;
    const price = typeof record.price === "number" ? record.price : Number(record.price);
    const id = typeof record.id === "string" && record.id.trim() ? record.id : "";
    if (!id || !symbol || !Number.isFinite(price) || price <= 0) continue;
    out.push({
      id,
      symbol,
      price,
      direction: record.direction === "below" ? "below" : "above",
      status: record.status === "triggered" ? "triggered" : "active",
      createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : new Date().toISOString(),
      triggeredAt: typeof record.triggeredAt === "string" && record.triggeredAt ? record.triggeredAt : undefined,
      triggerPrice: typeof record.triggerPrice === "number" && Number.isFinite(record.triggerPrice) ? record.triggerPrice : undefined,
    });
  }
  return out.slice(-200);
}

function makeAnnotationId() {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makePriceAlertId() {
  return `alert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

function compactNullable(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? compact(value) : "--";
}

function compactMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(abs >= 10_000_000_000_000 ? 0 : 1)}T`;
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return money(value);
}

function gainerModeLabel(mode: GainersData["mode"]): string {
  if (mode === "pre-market") return "PRE";
  if (mode === "post-market") return "POST";
  if (mode === "closed") return "CLOSED";
  return "REG";
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

function formatNewsDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
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

function williamsFractals(bars: Bar[]): WilliamsFractal[] {
  const fractals: WilliamsFractal[] = [];
  for (let index = 2; index < bars.length - 2; index += 1) {
    const bar = bars[index];
    const left2 = bars[index - 2];
    const left1 = bars[index - 1];
    const right1 = bars[index + 1];
    const right2 = bars[index + 2];
    const isHigh =
      bar.high > left2.high &&
      bar.high > left1.high &&
      bar.high > right1.high &&
      bar.high > right2.high;
    const isLow =
      bar.low < left2.low &&
      bar.low < left1.low &&
      bar.low < right1.low &&
      bar.low < right2.low;

    if (isHigh) {
      fractals.push({ time: bar.time, price: bar.high, kind: "high" });
    }
    if (isLow) {
      fractals.push({ time: bar.time, price: bar.low, kind: "low" });
    }
  }
  return fractals;
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
    fractals: williamsFractals(bars),
  };
}

function lineData(bars: Bar[], values: number[]) {
  return bars
    .map((bar, index) => ({ time: bar.time as Time, value: values[index] }))
    .filter((point) => Number.isFinite(point.value));
}

function numericCrosshairTime(time: MouseEventParams<Time>["time"] | CandlestickData<Time>["time"] | undefined): number | null {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  return null;
}

function candleInspectionFromBar(bar: Bar): CandleInspection {
  const change = bar.close - bar.open;
  return {
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    change,
    changePct: bar.open > 0 ? (change / bar.open) * 100 : 0,
    range: bar.high - bar.low,
  };
}

function formatCandleTime(unixSeconds: number, resolution: StackResolution): string {
  const date = new Date(unixSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    ...(resolution === "4h" ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
  }).format(date);
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

async function fetchScanner(mode: ScannerMode, signal?: AbortSignal) {
  const params = new URLSearchParams({
    mode,
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

async function fetchTopGainersWatchlist(signal?: AbortSignal) {
  const response = await fetch("/api/charts/gainers", {
    cache: "no-store",
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load top gainers.");
  }
  return json as GainersData;
}

async function fetchRobTopStocks(signal?: AbortSignal) {
  const response = await fetch("/api/charts/rob-list", {
    cache: "no-store",
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load Rob's List.");
  }
  return {
    symbols: normalizeRobTopStocks(json?.symbols),
    updatedAt: typeof json?.updatedAt === "string" ? json.updatedAt : null,
    updatedByEmail: typeof json?.updatedByEmail === "string" ? json.updatedByEmail : null,
  };
}

async function saveRobTopStocks(symbols: string[]) {
  const response = await fetch("/api/charts/rob-list", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbols }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to save Rob's List.");
  }
  return {
    symbols: normalizeRobTopStocks(json?.symbols),
    updatedAt: typeof json?.updatedAt === "string" ? json.updatedAt : null,
    updatedByEmail: typeof json?.updatedByEmail === "string" ? json.updatedByEmail : null,
  };
}

function useLiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return {
    clock: now ? formatEtTime(now) : "--:--:--",
    session: now ? sessionLabel(now) : "--",
  };
}

function lastBar(payload: ChartPayload | undefined): Bar | null {
  return payload?.bars.at(-1) ?? null;
}

function firstRegularBar(payload: ChartPayload | undefined): Bar | null {
  if (!payload) return null;
  return payload.bars.find((bar) => etMinuteOfDay(bar.time) >= 570) ?? payload.bars[0] ?? null;
}

function symbolRowsFromScanner(data: RvolScannerPayload | null, sortMode: RvolSortMode): RvolScannerHit[] {
  if (!data) return [];
  const seen = new Set<string>();
  const rows: RvolScannerHit[] = [];
  const sortedHits = [...data.hits].sort((a, b) => {
    if (sortMode === "recent") {
      return b.signalUnixSeconds - a.signalUnixSeconds ||
        b.signalRvol - a.signalRvol ||
        a.ticker.localeCompare(b.ticker);
    }
    return b.changePct - a.changePct ||
      b.signalRvol - a.signalRvol ||
      b.signalUnixSeconds - a.signalUnixSeconds ||
      a.ticker.localeCompare(b.ticker);
  });
  for (const hit of sortedHits) {
    if (seen.has(hit.ticker)) continue;
    seen.add(hit.ticker);
    rows.push(hit);
  }
  return rows.slice(0, 20);
}

function polygonTimestampMs(value: unknown): number | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  if (timestamp > 1e16) return Math.floor(timestamp / 1_000_000);
  if (timestamp > 1e14) return Math.floor(timestamp / 1_000);
  if (timestamp > 1e11) return Math.floor(timestamp);
  return Math.floor(timestamp * 1000);
}

function formatGainerUpdatedAt(value: unknown): string {
  const timestamp = polygonTimestampMs(value);
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date) + " ET";
}

function symbolRowsFromGainers(data: GainersData | null, sortMode: TopGainersSortMode): PolygonTickerSnapshot[] {
  if (!data) return [];
  return [...data.tickers].sort((a, b) => {
    const aUpdated = polygonTimestampMs(a.updated) ?? 0;
    const bUpdated = polygonTimestampMs(b.updated) ?? 0;
    const aGain = Number(a.todaysChangePerc) || 0;
    const bGain = Number(b.todaysChangePerc) || 0;
    if (sortMode === "updated") {
      return bUpdated - aUpdated || bGain - aGain || a.ticker.localeCompare(b.ticker);
    }
    return bGain - aGain || bUpdated - aUpdated || a.ticker.localeCompare(b.ticker);
  }).slice(0, 20);
}

function rvolAlertKey(hit: RvolScannerHit): string {
  return `${hit.ticker}:${hit.resolution}:${hit.signalUnixSeconds}`;
}

function playRvolAlertSound() {
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(1175, context.currentTime + 0.08);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.24);
  window.setTimeout(() => void context.close(), 320);
}

function signalHitKey(symbol: string, resolution: StackResolution): string {
  return `${symbol}:${resolution}`;
}

function monthlyPivotForSymbol(hits: RvolScannerHit[], symbol: string): MonthlyPivotTarget | null {
  return hits.find((hit) => hit.ticker === symbol && hit.monthlyPivotTarget)?.monthlyPivotTarget ?? null;
}

function monthlyPivotsForSymbol(hits: RvolScannerHit[], symbol: string): MonthlyPivotTarget[] {
  const hit = hits.find((row) => row.ticker === symbol && (row.monthlyPivotsAbovePrice?.length || row.monthlyPivotTarget));
  if (!hit) return [];
  if (hit.monthlyPivotsAbovePrice?.length) {
    return hit.monthlyPivotsAbovePrice.slice(0, 2);
  }
  return hit.monthlyPivotTarget ? [hit.monthlyPivotTarget] : [];
}

function recentFourHourHighs(bars: Bar[]): Array<{ price: number; time: number }> {
  const highs: Array<{ price: number; time: number }> = [];
  for (let index = bars.length - 2; index >= 1; index -= 1) {
    const bar = bars[index];
    if (bar.high >= bars[index - 1].high && bar.high >= bars[index + 1].high) {
      highs.push({ price: bar.high, time: bar.time });
      if (highs.length === 2) return highs;
    }
  }

  for (let index = bars.length - 1; index >= 0 && highs.length < 2; index -= 1) {
    const bar = bars[index];
    if (!highs.some((high) => high.time === bar.time)) {
      highs.push({ price: bar.high, time: bar.time });
    }
  }

  return highs;
}

function ChartSlotControls({
  symbol,
  resolution,
  onSymbolChange,
  onResolutionChange,
}: {
  symbol: string;
  resolution: StackResolution;
  onSymbolChange: (symbol: string) => void;
  onResolutionChange: (resolution: StackResolution) => void;
}) {
  const [draft, setDraft] = useState(symbol);

  useEffect(() => {
    setDraft(symbol);
  }, [symbol]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ticker = normalizeTicker(draft);
    if (!ticker) {
      setDraft(symbol);
      return;
    }
    onSymbolChange(ticker);
  }

  return (
    <div className="stack-chart-controls">
      <form className="stack-chart-symbol" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const ticker = normalizeTicker(draft);
            setDraft(ticker ?? symbol);
            if (ticker) onSymbolChange(ticker);
          }}
          aria-label="Chart symbol"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </form>
      <select
        value={resolution}
        onChange={(event) => onResolutionChange(event.target.value as StackResolution)}
        aria-label="Chart timeframe"
      >
        {RESOLUTIONS.map((item) => (
          <option key={item.value} value={item.value}>{item.timeframe}</option>
        ))}
      </select>
    </div>
  );
}

function StackChartPanel({
  payload,
  resolution,
  role,
  title,
  controls,
  visibleBars,
  loading,
  error = null,
  palette,
  signalHits = [],
  monthlyPivotTarget = null,
  monthlyPivotLevels = [],
  showRecentHighs = true,
  showFractals = false,
  showGhostPivot = true,
  drawingTool,
  annotations,
  priceAlerts = [],
  onToggleRecentHighs,
  onToggleFractals,
  onToggleGhostPivot,
  onAddAnnotation,
  onUpdateAnnotation,
  onRemoveAnnotation,
}: {
  payload: ChartPayload | undefined;
  resolution: StackResolution;
  role: string;
  title?: string;
  controls?: ReactNode;
  visibleBars: number;
  loading: boolean;
  error?: string | null;
  palette: StackChartPalette;
  signalHits?: RvolScannerHit[];
  monthlyPivotTarget?: MonthlyPivotTarget | null;
  monthlyPivotLevels?: MonthlyPivotTarget[];
  showRecentHighs?: boolean;
  showFractals?: boolean;
  showGhostPivot?: boolean;
  drawingTool: DrawingTool;
  annotations: ChartAnnotation[];
  priceAlerts?: PriceAlert[];
  onToggleRecentHighs: () => void;
  onToggleFractals: () => void;
  onToggleGhostPivot: () => void;
  onAddAnnotation: (annotation: ChartAnnotation) => void;
  onUpdateAnnotation: (annotation: ChartAnnotation) => void;
  onRemoveAnnotation: (id: string) => void;
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
  const textCommitRef = useRef(false);
  const textDragRef = useRef<{ id: string; pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const visibleRangeSpanRef = useRef(visibleBars + CHART_RIGHT_OFFSET);
  const timeScaleStorageKeyRef = useRef("");
  const [surfaceTick, setSurfaceTick] = useState(0);
  const [arrowDraft, setArrowDraft] = useState<{ start: ChartAnchor; end: ChartAnchor } | null>(null);
  const [textDraft, setTextDraft] = useState<{ anchor: ChartAnchor; text: string } | null>(null);
  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);
  const [candleInspection, setCandleInspection] = useState<CandleInspection | null>(null);
  const timeScaleStorageKey = useMemo(
    () => chartTimeScaleStorageKey(payload?.ticker ?? title ?? "chart", resolution),
    [payload?.ticker, resolution, title],
  );
  const barByTime = useMemo(() => new Map((payload?.bars ?? []).map((bar) => [bar.time, bar])), [payload?.bars]);

  const indicators = useMemo(
    () => indicatorsFor(payload?.bars ?? [], resolution),
    [payload?.bars, resolution],
  );
  const recentHighs = useMemo(
    () => (resolution === "4h" && payload ? recentFourHourHighs(payload.bars) : []),
    [payload, resolution],
  );
  const displayedMonthlyPivots = useMemo(() => {
    const chartLevels = payload?.monthlyPivots?.monthlyPivotsAbovePrice ?? [];
    const chartTarget = payload?.monthlyPivots?.monthlyPivotTarget ?? null;
    const levels = chartLevels.length
      ? chartLevels
      : chartTarget
        ? [chartTarget]
        : monthlyPivotLevels.length
          ? monthlyPivotLevels
          : monthlyPivotTarget
            ? [monthlyPivotTarget]
            : [];
    return levels.slice(0, 2);
  }, [monthlyPivotLevels, monthlyPivotTarget, payload?.monthlyPivots]);

  useEffect(() => {
    const fallbackSpan = visibleBars + CHART_RIGHT_OFFSET;
    timeScaleStorageKeyRef.current = timeScaleStorageKey;
    visibleRangeSpanRef.current = readStoredVisibleRangeSpan(timeScaleStorageKey, fallbackSpan);
  }, [timeScaleStorageKey, visibleBars]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: palette.bgPanel },
        textColor: palette.textFaint,
        fontFamily: "IBM Plex Mono, ui-monospace, Menlo, monospace",
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: palette.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: palette.neutral, width: 1, style: LineStyle.Dotted },
        horzLine: { color: palette.neutral, width: 1, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: palette.border,
        scaleMargins: DEFAULT_PRICE_SCALE_MARGINS,
        minimumWidth: 58,
      },
      timeScale: {
        visible: true,
        timeVisible: resolution !== "4h",
        secondsVisible: false,
        borderVisible: true,
        borderColor: palette.border,
        rightOffset: CHART_RIGHT_OFFSET,
        barSpacing: resolution === "4h" ? 7 : 6,
        minBarSpacing: 2,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
        axisDoubleClickReset: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
    });

    chartRef.current = chart;
    candleRef.current = chart.addCandlestickSeries({
      upColor: palette.up,
      downColor: palette.down,
      borderUpColor: palette.up,
      borderDownColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      priceLineColor: palette.up,
    });
    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeRef.current.priceScale().applyOptions({
      scaleMargins: { top: 0.86, bottom: 0 },
    });
    ema9Ref.current = chart.addLineSeries({
      color: palette.ema9,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema21Ref.current = chart.addLineSeries({
      color: palette.ema21,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema50Ref.current = chart.addLineSeries({
      color: palette.ema50,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    vwapRef.current = chart.addLineSeries({
      color: palette.alert,
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
      setSurfaceTick((current) => current + 1);
    });
    observer.observe(container);
    const handleVisibleRangeChange = () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) {
        const nextSpan = normalizeVisibleRangeSpan(
          range.to - range.from,
          visibleRangeSpanRef.current,
        );
        visibleRangeSpanRef.current = nextSpan;
        if (timeScaleStorageKeyRef.current) {
          writeStoredVisibleRangeSpan(timeScaleStorageKeyRef.current, nextSpan);
        }
      }
      setSurfaceTick((current) => current + 1);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    return () => {
      observer.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
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
  }, [palette]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const crosshairActive = drawingTool === "crosshair";
    chart.applyOptions({
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { visible: crosshairActive, color: palette.neutral, width: 1, style: LineStyle.Dotted },
        horzLine: { visible: crosshairActive, color: palette.neutral, width: 1, style: LineStyle.Dotted },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: drawingTool === "pan",
        horzTouchDrag: drawingTool === "pan",
        vertTouchDrag: drawingTool === "pan",
      },
    });
    if (!crosshairActive) setCandleInspection(null);
  }, [drawingTool, palette]);

  useEffect(() => {
    const chart = chartRef.current;
    const candles = candleRef.current;
    if (!chart || !candles) return;
    const candleSeries = candles;

    function handleCrosshairMove(params: MouseEventParams<Time>) {
      const container = containerRef.current;
      if (drawingTool !== "crosshair" || !payload || !container || !params.point) {
        setCandleInspection(null);
        return;
      }
      if (
        params.point.x < 0 ||
        params.point.y < 0 ||
        params.point.x > container.clientWidth ||
        params.point.y > container.clientHeight
      ) {
        setCandleInspection(null);
        return;
      }
      const hoveredCandle = params.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
      const time = numericCrosshairTime(hoveredCandle?.time ?? params.time);
      const bar = time === null ? null : barByTime.get(time);
      setCandleInspection(bar ? candleInspectionFromBar(bar) : null);
    }

    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => chart.unsubscribeCrosshairMove(handleCrosshairMove);
  }, [barByTime, drawingTool, palette, payload]);

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
          color: bar.close >= bar.open ? palette.volumeUp : palette.volumeDown,
        }),
      ),
    );
    ema9Line.setData(lineData(payload.bars, indicators.ema9));
    ema21Line.setData(lineData(payload.bars, indicators.ema21));
    ema50Line.setData(lineData(payload.bars, indicators.ema50));
    vwapLine.setData(lineData(payload.bars, indicators.vwap));
    const markers: SeriesMarker<Time>[] = signalHits.map((hit) => ({
        time: hit.signalUnixSeconds as Time,
        position: "belowBar" as const,
        color: palette.alert,
        shape: "arrowUp" as const,
        size: 2,
        text: `RVOL ${hit.signalRvol.toFixed(1)}X`,
    }));
    if (showFractals) {
      markers.push(
        ...indicators.fractals.map((fractal) => ({
          time: fractal.time as Time,
          position: fractal.kind === "high" ? "aboveBar" as const : "belowBar" as const,
          color: fractal.kind === "high" ? palette.fractalHigh : palette.fractalLow,
          shape: fractal.kind === "high" ? "arrowDown" as const : "arrowUp" as const,
          size: 0.8,
        })),
      );
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    candles.setMarkers(markers);

    for (const line of priceLinesRef.current) {
      candles.removePriceLine(line);
    }
    priceLinesRef.current = [];

    if (resolution !== "4h") {
      if (indicators.pmHigh) {
        priceLinesRef.current.push(candles.createPriceLine({
          price: indicators.pmHigh,
          color: palette.neutral,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `PM HIGH ${indicators.pmHigh.toFixed(2)}`,
        }));
      }
      if (indicators.pmLow) {
        priceLinesRef.current.push(candles.createPriceLine({
          price: indicators.pmLow,
          color: palette.neutral,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `PM LOW ${indicators.pmLow.toFixed(2)}`,
        }));
      }
    }
    if (showGhostPivot && payload.ghostPivot) {
      priceLinesRef.current.push(candles.createPriceLine({
        price: payload.ghostPivot.price,
        color: palette.ghost,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `GHOST PIVOT ${payload.ghostPivot.activeMonthLabel.toUpperCase()} ${payload.ghostPivot.price.toFixed(2)}`,
      }));
    }
    if (resolution === "4h") {
      displayedMonthlyPivots.forEach((pivot, index) => {
        priceLinesRef.current.push(candles.createPriceLine({
          price: pivot.price,
          color: palette.alert,
          lineWidth: index === 0 ? 2 : 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `MISSED PIVOT ${index + 1} ${pivot.price.toFixed(2)}`,
        }));
      });
      if (showRecentHighs) {
        recentHighs.forEach((high, index) => {
          priceLinesRef.current.push(candles.createPriceLine({
            price: high.price,
            color: index === 0 ? palette.ema9 : palette.ema21,
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: `4H HIGH ${index + 1} ${high.price.toFixed(2)}`,
          }));
        });
      }
    }

    priceAlerts.forEach((alert) => {
      priceLinesRef.current.push(candles.createPriceLine({
        price: alert.price,
        color: alert.status === "triggered" ? palette.neutral : palette.alert,
        lineWidth: alert.status === "triggered" ? 1 : 2,
        lineStyle: alert.status === "triggered" ? LineStyle.Dotted : LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${alert.status === "triggered" ? "HIT" : "ALERT"} ${alert.direction.toUpperCase()} ${alert.price.toFixed(2)}`,
      }));
    });

    if (payload.bars.length > 0) {
      const preferredSpan = normalizeVisibleRangeSpan(
        visibleRangeSpanRef.current,
        visibleBars + CHART_RIGHT_OFFSET,
      );
      const rightEdge = payload.bars.length + CHART_RIGHT_OFFSET;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, rightEdge - preferredSpan),
        to: rightEdge,
      });
    }
  }, [displayedMonthlyPivots, indicators, palette, payload, priceAlerts, recentHighs, resolution, showFractals, showGhostPivot, showRecentHighs, signalHits, visibleBars]);

  useEffect(() => {
    setArrowDraft(null);
    setTextDraft(null);
    textDragRef.current = null;
    setDraggingTextId(null);
    setCandleInspection(null);
  }, [payload?.ticker, resolution]);

  function anchorFromSurfacePoint(x: number, y: number): ChartAnchor | null {
    const container = containerRef.current;
    if (!container) return null;
    const chartX = Math.min(container.clientWidth, Math.max(0, x));
    const chartY = Math.min(container.clientHeight, Math.max(0, y));
    const anchor: ChartAnchor = {
      x: Math.min(1, Math.max(0, chartX / Math.max(1, container.clientWidth))),
      y: Math.min(1, Math.max(0, chartY / Math.max(1, container.clientHeight))),
    };
    const chart = chartRef.current;
    const candles = candleRef.current;
    const time = chart?.timeScale().coordinateToTime(chartX);
    const price = candles?.coordinateToPrice(chartY);
    if (typeof time === "number") anchor.time = time;
    if (typeof price === "number" && Number.isFinite(price)) anchor.price = price;
    return anchor;
  }

  function anchorFromPointer(event: ReactPointerEvent<HTMLElement>): ChartAnchor | null {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return anchorFromSurfacePoint(event.clientX - rect.left, event.clientY - rect.top);
  }

  function pointForAnchor(anchor: ChartAnchor): { x: number; y: number } | null {
    const container = containerRef.current;
    if (container && typeof anchor.x === "number" && typeof anchor.y === "number") {
      return {
        x: anchor.x * container.clientWidth,
        y: anchor.y * container.clientHeight,
      };
    }
    const chart = chartRef.current;
    const candles = candleRef.current;
    if (!chart || !candles || typeof anchor.time !== "number" || typeof anchor.price !== "number") return null;
    const x = chart.timeScale().timeToCoordinate(anchor.time as Time);
    const y = candles.priceToCoordinate(anchor.price);
    if (typeof x !== "number" || typeof y !== "number") return null;
    return { x, y };
  }

  function handleAnnotationPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!payload) return;
    if (drawingTool === "arrow") {
      const anchor = anchorFromPointer(event);
      if (!anchor) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setArrowDraft({ start: anchor, end: anchor });
      return;
    }
    if (drawingTool === "text") {
      if ((event.target as HTMLElement).closest(".stack-annotation-draft, .stack-annotation-text")) return;
      const anchor = anchorFromPointer(event);
      if (!anchor) return;
      event.preventDefault();
      textCommitRef.current = false;
      setTextDraft({ anchor, text: "" });
    }
  }

  function handleAnnotationPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawingTool !== "arrow" || !arrowDraft) return;
    const anchor = anchorFromPointer(event);
    if (!anchor) return;
    setArrowDraft({ start: arrowDraft.start, end: anchor });
  }

  function handleAnnotationPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!payload || drawingTool !== "arrow" || !arrowDraft) return;
    const end = anchorFromPointer(event) ?? arrowDraft.end;
    const startPoint = pointForAnchor(arrowDraft.start);
    const endPoint = pointForAnchor(end);
    setArrowDraft(null);
    if (startPoint && endPoint && Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y) < 8) return;
    onAddAnnotation({
      id: makeAnnotationId(),
      symbol: payload.ticker,
      resolution,
      type: "arrow",
      start: arrowDraft.start,
      end,
    });
  }

  function handleTextAnnotationPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    annotation: ChartTextAnnotation,
    point: { x: number; y: number },
  ) {
    event.stopPropagation();
    if (drawingTool === "erase") {
      onRemoveAnnotation(annotation.id);
      return;
    }

    const container = containerRef.current;
    if (!payload || !container) return;
    const rect = container.getBoundingClientRect();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    textDragRef.current = {
      id: annotation.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left - point.x,
      offsetY: event.clientY - rect.top - point.y,
    };
    setDraggingTextId(annotation.id);
  }

  function handleTextAnnotationPointerMove(event: ReactPointerEvent<HTMLButtonElement>, annotation: ChartTextAnnotation) {
    const drag = textDragRef.current;
    const container = containerRef.current;
    if (!drag || drag.id !== annotation.id || drag.pointerId !== event.pointerId || !container) return;
    const rect = container.getBoundingClientRect();
    const anchor = anchorFromSurfacePoint(
      event.clientX - rect.left - drag.offsetX,
      event.clientY - rect.top - drag.offsetY,
    );
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    onUpdateAnnotation({ ...annotation, at: anchor });
  }

  function handleTextAnnotationPointerUp(event: ReactPointerEvent<HTMLButtonElement>, annotation: ChartTextAnnotation) {
    const drag = textDragRef.current;
    if (!drag || drag.id !== annotation.id || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    textDragRef.current = null;
    setDraggingTextId(null);
  }

  function submitTextDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveTextDraft();
  }

  function saveTextDraft() {
    if (!payload || !textDraft || textCommitRef.current) return;
    textCommitRef.current = true;
    const text = textDraft.text.trim().slice(0, 64);
    const anchor = textDraft.anchor;
    setTextDraft(null);
    if (!text) return;
    onAddAnnotation({
      id: makeAnnotationId(),
      symbol: payload.ticker,
      resolution,
      type: "text",
      at: anchor,
      text,
    });
  }

  function resetVisibleRange() {
    const chart = chartRef.current;
    if (!payload || payload.bars.length === 0 || !chart) return;

    const defaultSpan = visibleBars + CHART_RIGHT_OFFSET;
    const rightEdge = payload.bars.length + CHART_RIGHT_OFFSET;
    visibleRangeSpanRef.current = defaultSpan;

    try {
      window.localStorage.removeItem(timeScaleStorageKeyRef.current || timeScaleStorageKey);
    } catch {
      // Some privacy modes can block localStorage writes.
    }

    chart.priceScale("right").applyOptions({
      autoScale: true,
      scaleMargins: DEFAULT_PRICE_SCALE_MARGINS,
    });
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, rightEdge - defaultSpan),
      to: rightEdge,
    });
    setSurfaceTick((current) => current + 1);
  }

  const markerId = `stack-arrow-${(payload?.ticker ?? title ?? "chart").replace(/[^A-Za-z0-9_-]/g, "")}-${resolution}`;
  const renderedArrows = annotations
    .filter((annotation): annotation is ChartArrowAnnotation => annotation.type === "arrow")
    .map((annotation) => ({ annotation, start: pointForAnchor(annotation.start), end: pointForAnchor(annotation.end), tick: surfaceTick }))
    .filter((item) => item.start && item.end);
  const renderedText = annotations
    .filter((annotation): annotation is ChartTextAnnotation => annotation.type === "text")
    .map((annotation) => ({ annotation, point: pointForAnchor(annotation.at), tick: surfaceTick }))
    .filter((item) => item.point);
  const draftStart = arrowDraft ? pointForAnchor(arrowDraft.start) : null;
  const draftEnd = arrowDraft ? pointForAnchor(arrowDraft.end) : null;
  const draftTextPoint = textDraft ? pointForAnchor(textDraft.anchor) : null;
  const watermarkSymbol = payload?.ticker ?? title ?? "";
  const watermarkTimeframe = RESOLUTIONS.find((item) => item.value === resolution)?.timeframe ?? resolution.toUpperCase();
  const watermarkLabel = `${watermarkSymbol} ${watermarkTimeframe}`.trim();
  const inspectionDirectionClass = candleInspection && candleInspection.change < 0 ? "is-down" : "is-up";
  const annotationToolActive = drawingTool === "arrow" || drawingTool === "text" || drawingTool === "erase";

  return (
    <section className={`stack-chart stack-chart--${resolution}`}>
      <header className="stack-chart__header">
        <div className="stack-chart__title">
          <strong>{title ?? resolution.toUpperCase()}</strong>
          <span>{role}</span>
        </div>
        {controls}
        <div className="stack-legend" aria-label={`${resolution} indicators`}>
          <span><i className="dot dot--vwap" />VWAP</span>
          <span><i className="dot dot--ema9" />EMA 9</span>
          <span><i className="dot dot--ema21" />EMA 21</span>
          <span><i className="dot dot--ema50" />EMA 50</span>
          {resolution !== "4h" && <span><i className="dot dot--pm" />PM</span>}
          {signalHits.length > 0 && <span><i className="dot dot--alert" />RVOL</span>}
          {resolution === "4h" && displayedMonthlyPivots.length > 0 && <span><i className="dot dot--alert" />PIVOTS {displayedMonthlyPivots.length}</span>}
        </div>
      </header>
      <div className="stack-chart__surface">
        <div ref={containerRef} className="stack-chart__canvas" />
        {watermarkLabel && <div className="stack-chart__watermark" aria-hidden="true">{watermarkLabel}</div>}
        <div className="stack-overlay-chips" role="toolbar" aria-label={`${title ?? payload?.ticker ?? resolution} chart overlays`}>
          {payload?.ghostPivot && (
            <button
              type="button"
              className="stack-overlay-chip stack-overlay-chip--ghost"
              aria-pressed={showGhostPivot}
              aria-label="Ghost Pivot"
              title="Ghost Pivot"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onToggleGhostPivot}
            >
              GP
            </button>
          )}
          {resolution === "4h" && (
            <button
              type="button"
              className="stack-overlay-chip stack-overlay-chip--high"
              aria-pressed={showRecentHighs}
              aria-label="4H Highs"
              title="4H Highs"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onToggleRecentHighs}
            >
              4H
            </button>
          )}
          <button
            type="button"
            className="stack-overlay-chip stack-overlay-chip--fractal"
            aria-pressed={showFractals}
            aria-label="Williams Fractals"
            title="Williams Fractals"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onToggleFractals}
          >
            FR
          </button>
          <button
            type="button"
            className="stack-overlay-chip stack-overlay-chip--reset"
            aria-label="Reset chart size"
            title="Reset chart size"
            disabled={!payload || payload.bars.length === 0}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={resetVisibleRange}
          >
            RST
          </button>
        </div>
        {resolution === "4h" && displayedMonthlyPivots.length > 0 && (
          <table className="stack-pivot-table" aria-label="Missed monthly pivots above current price">
            <caption>MISSED MONTHLY PIVOTS</caption>
            <tbody>
              {displayedMonthlyPivots.map((pivot, index) => (
                <tr key={`${pivot.sourceMonth}-${pivot.price}`}>
                  <th scope="row">#{index + 1}</th>
                  <td>{money(pivot.price)}</td>
                  <td>{pivot.sourceMonthLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showGhostPivot && payload?.ghostPivot && (
          <table className="stack-pivot-table stack-pivot-table--ghost" aria-label="Ghost pivot">
            <caption>{payload.ghostPivot.activeMonthLabel.toUpperCase()} GHOST PIVOT</caption>
            <tbody>
              <tr>
                <th scope="row">GP</th>
                <td>{money(payload.ghostPivot.price)}</td>
                <td>{payload.ghostPivot.sourceMonthLabel}</td>
              </tr>
            </tbody>
          </table>
        )}
        <div
          className={[
            "stack-annotation-layer",
            annotationToolActive ? "is-drawing" : "",
            drawingTool === "erase" ? "is-erasing" : "",
          ].filter(Boolean).join(" ")}
          aria-label={`${title ?? payload?.ticker ?? resolution} drawing layer`}
          onPointerDown={handleAnnotationPointerDown}
          onPointerMove={handleAnnotationPointerMove}
          onPointerUp={handleAnnotationPointerUp}
        >
          <svg className="stack-annotation-svg" aria-hidden="true">
            <defs>
              <marker id={markerId} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L9,4.5 L0,9 Z" />
              </marker>
            </defs>
            {renderedArrows.map(({ annotation, start, end }) => (
              <line
                key={annotation.id}
                className="stack-annotation-arrow"
                x1={start?.x}
                y1={start?.y}
                x2={end?.x}
                y2={end?.y}
                markerEnd={`url(#${markerId})`}
                onPointerDown={(event) => {
                  if (drawingTool !== "erase") return;
                  event.stopPropagation();
                  onRemoveAnnotation(annotation.id);
                }}
                onClick={(event) => {
                  if (drawingTool !== "erase") return;
                  event.stopPropagation();
                  onRemoveAnnotation(annotation.id);
                }}
              />
            ))}
            {draftStart && draftEnd && (
              <line
                className="stack-annotation-arrow stack-annotation-arrow--draft"
                x1={draftStart.x}
                y1={draftStart.y}
                x2={draftEnd.x}
                y2={draftEnd.y}
                markerEnd={`url(#${markerId})`}
              />
            )}
          </svg>
          {renderedText.map(({ annotation, point }) => (
            <button
              key={annotation.id}
              type="button"
              className={[
                "stack-annotation-text",
                draggingTextId === annotation.id ? "is-dragging" : "",
              ].filter(Boolean).join(" ")}
              style={{ left: point?.x, top: point?.y }}
              aria-label={`Move text note: ${annotation.text}`}
              onPointerDown={(event) => handleTextAnnotationPointerDown(event, annotation, point as { x: number; y: number })}
              onPointerMove={(event) => handleTextAnnotationPointerMove(event, annotation)}
              onPointerUp={(event) => handleTextAnnotationPointerUp(event, annotation)}
              onPointerCancel={(event) => handleTextAnnotationPointerUp(event, annotation)}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {annotation.text}
            </button>
          ))}
          {textDraft && draftTextPoint && (
            <form
              className="stack-annotation-draft"
              style={{ left: draftTextPoint.x, top: draftTextPoint.y }}
              onSubmit={submitTextDraft}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <input
                value={textDraft.text}
                onChange={(event) => setTextDraft({ ...textDraft, text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveTextDraft();
                  }
                  if (event.key === "Escape") setTextDraft(null);
                }}
                onBlur={saveTextDraft}
                aria-label="Chart text note"
                name="chartTextNote"
                autoFocus
              />
            </form>
          )}
        </div>
        {drawingTool === "crosshair" && candleInspection && (
          <div className="stack-candle-inspector" aria-label={`${watermarkLabel} candle details`}>
            <div className="stack-candle-inspector__head">
              <strong>{formatCandleTime(candleInspection.time, resolution)}</strong>
              <span className={inspectionDirectionClass}>{pct(candleInspection.changePct)}</span>
            </div>
            <dl>
              <div><dt>O</dt><dd>{money(candleInspection.open)}</dd></div>
              <div><dt>H</dt><dd>{money(candleInspection.high)}</dd></div>
              <div><dt>L</dt><dd>{money(candleInspection.low)}</dd></div>
              <div><dt>C</dt><dd>{money(candleInspection.close)}</dd></div>
              <div><dt>VOL</dt><dd>{compact(candleInspection.volume)}</dd></div>
              <div><dt>RNG</dt><dd>{money(candleInspection.range)}</dd></div>
            </dl>
          </div>
        )}
        {loading && (
          <div className="stack-chart__skeleton" role="status">
            LOADING {resolution.toUpperCase()}
          </div>
        )}
        {!loading && error && (
          <div className="stack-chart__skeleton stack-chart__skeleton--error" role="status">
            {error}
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
  const [watchlistInput, setWatchlistInput] = useState("");
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [watchlistTab, setWatchlistTab] = useState<WatchlistTab>("rvol");
  const [watchlists, setWatchlists] = useState<UserWatchlist[]>(DEFAULT_WATCHLISTS);
  const [robListDraft, setRobListDraft] = useState(DEFAULT_ROB_TOP_STOCKS.join("\n"));
  const [robListEditing, setRobListEditing] = useState(false);
  const [robListSaving, setRobListSaving] = useState(false);
  const [robListMessage, setRobListMessage] = useState<string | null>(null);
  const [activeWatchlistId, setActiveWatchlistId] = useState(DEFAULT_WATCHLIST_ID);
  const [draggedSymbol, setDraggedSymbol] = useState<string | null>(null);
  const [chartTheme, setChartTheme] = useState<StackChartTheme>("dark");
  const [viewMode, setViewMode] = useState<ChartViewMode>("stack");
  const [rvolSortMode, setRvolSortMode] = useState<RvolSortMode>("recent");
  const [topGainersSortMode, setTopGainersSortMode] = useState<TopGainersSortMode>("updated");
  const [rvolSoundEnabled, setRvolSoundEnabled] = useState(false);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("pan");
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [priceAlertInput, setPriceAlertInput] = useState("");
  const [showRecentHighs, setShowRecentHighs] = useState(true);
  const [showFractals, setShowFractals] = useState(false);
  const [showGhostPivot, setShowGhostPivot] = useState(true);
  const [singleResolution, setSingleResolution] = useState<StackResolution>("5m");
  const [quadSlots, setQuadSlots] = useState<ChartSlot[]>(() => normalizeChartSlots(DEFAULT_QUAD_SLOTS, initialSymbol));
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const symbolInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const seenRvolAlertKeysRef = useRef<Set<string>>(new Set());
  const scannerSoundReadyRef = useRef(false);
  const seenPriceAlertTriggerIdsRef = useRef<Set<string>>(new Set());
  const priceAlertSoundReadyRef = useRef(false);
  const quadSlotRequestKeysRef = useRef<Record<string, string>>({});
  const quadChartsRef = useRef<Record<string, SingleChartState>>({});
  const [charts, setCharts] = useState<ChartState>({
    status: "loading",
    data: {},
    error: null,
  });
  const [quadCharts, setQuadCharts] = useState<Record<string, SingleChartState>>({});
  const [scanner, setScanner] = useState<ScannerState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [longTermScanner, setLongTermScanner] = useState<ScannerState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [topGainers, setTopGainers] = useState<TopGainersState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [robTopStocks, setRobTopStocks] = useState<RobTopStocksState>({
    status: "loading",
    symbols: DEFAULT_ROB_TOP_STOCKS,
    error: null,
    updatedAt: null,
    updatedByEmail: null,
  });
  const [viewer, setViewer] = useState<ViewerState>({
    status: "loading",
    email: null,
  });
  const [positions, setPositions] = useState<PositionState>({
    status: "idle",
    positions: [],
  });
  const [companyInfo, setCompanyInfo] = useState<CompanyInfoState>({
    status: "loading",
    fundamentals: null,
    snapshot: null,
    news: null,
    error: null,
  });

  useEffect(() => {
    try {
      const storedWatchlists = window.localStorage.getItem(WATCHLISTS_KEY);
      const parsedWatchlists = storedWatchlists ? normalizeWatchlists(JSON.parse(storedWatchlists)) : null;
      if (parsedWatchlists) {
        setWatchlists(parsedWatchlists);
        const storedActiveId = window.localStorage.getItem(ACTIVE_WATCHLIST_KEY);
        setActiveWatchlistId(
          storedActiveId && parsedWatchlists.some((list) => list.id === storedActiveId)
            ? storedActiveId
            : parsedWatchlists[0].id,
        );
        return;
      }

      const legacyStored = window.localStorage.getItem(MY_LIST_KEY);
      const legacyParsed = legacyStored ? JSON.parse(legacyStored) : null;
      if (Array.isArray(legacyParsed)) {
        const symbols = uniqueSymbols(legacyParsed.filter((item) => typeof item === "string"));
        if (symbols.length > 0) {
          setWatchlists([{ id: DEFAULT_WATCHLIST_ID, name: "Main", symbols }]);
        }
      }
    } catch {
      setWatchlists(DEFAULT_WATCHLISTS);
      setActiveWatchlistId(DEFAULT_WATCHLIST_ID);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") {
      setChartTheme(stored);
    }
    const storedView = window.localStorage.getItem(VIEW_MODE_KEY);
    if (storedView === "stack" || storedView === "quad" || storedView === "single") {
      setViewMode(storedView);
    }
    const storedWatchlistTab = window.localStorage.getItem(WATCHLIST_TAB_KEY);
    if (storedWatchlistTab === "rvol" || storedWatchlistTab === "robTop" || storedWatchlistTab === "topGainers" || storedWatchlistTab === "myList") {
      setWatchlistTab(storedWatchlistTab);
    }
    const storedRvolSort = window.localStorage.getItem(RVOL_SORT_KEY);
    if (storedRvolSort === "recent" || storedRvolSort === "move") {
      setRvolSortMode(storedRvolSort);
    }
    const storedTopGainersSort = window.localStorage.getItem(TOP_GAINERS_SORT_KEY);
    if (storedTopGainersSort === "updated" || storedTopGainersSort === "gain") {
      setTopGainersSortMode(storedTopGainersSort);
    }
    const storedRvolSound = window.localStorage.getItem(RVOL_SOUND_KEY);
    if (storedRvolSound === "0" || storedRvolSound === "1") {
      setRvolSoundEnabled(storedRvolSound === "1");
    }
    try {
      const storedAnnotations = window.localStorage.getItem(ANNOTATIONS_KEY);
      if (storedAnnotations) {
        setAnnotations(normalizeAnnotations(JSON.parse(storedAnnotations)));
      }
    } catch {
      setAnnotations([]);
    }
    try {
      const storedAlerts = window.localStorage.getItem(PRICE_ALERTS_KEY);
      if (storedAlerts) {
        setPriceAlerts(normalizePriceAlerts(JSON.parse(storedAlerts)));
      }
    } catch {
      setPriceAlerts([]);
    }
    const storedHighs = window.localStorage.getItem(SHOW_RECENT_HIGHS_KEY);
    if (storedHighs === "0" || storedHighs === "1") {
      setShowRecentHighs(storedHighs === "1");
    }
    const storedFractals = window.localStorage.getItem(SHOW_FRACTALS_KEY);
    if (storedFractals === "0" || storedFractals === "1") {
      setShowFractals(storedFractals === "1");
    }
    const storedGhostPivot = window.localStorage.getItem(SHOW_GHOST_PIVOT_KEY);
    if (storedGhostPivot === "0" || storedGhostPivot === "1") {
      setShowGhostPivot(storedGhostPivot === "1");
    }
    const storedSingleResolution = window.localStorage.getItem(SINGLE_RESOLUTION_KEY);
    if (storedSingleResolution === "1m" || storedSingleResolution === "5m" || storedSingleResolution === "4h") {
      setSingleResolution(storedSingleResolution);
    }
    try {
      const storedSlots = window.localStorage.getItem(QUAD_SLOTS_KEY);
      if (storedSlots) {
        setQuadSlots(normalizeChartSlots(JSON.parse(storedSlots), initialSymbol));
      }
    } catch {
      setQuadSlots(normalizeChartSlots(DEFAULT_QUAD_SLOTS, initialSymbol));
    }
    setPreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(THEME_KEY, chartTheme);
  }, [chartTheme, preferencesLoaded]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [preferencesLoaded, viewMode]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(WATCHLIST_TAB_KEY, watchlistTab);
  }, [preferencesLoaded, watchlistTab]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(RVOL_SORT_KEY, rvolSortMode);
  }, [preferencesLoaded, rvolSortMode]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(TOP_GAINERS_SORT_KEY, topGainersSortMode);
  }, [preferencesLoaded, topGainersSortMode]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(RVOL_SOUND_KEY, rvolSoundEnabled ? "1" : "0");
  }, [preferencesLoaded, rvolSoundEnabled]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations.slice(-500)));
  }, [annotations, preferencesLoaded]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(PRICE_ALERTS_KEY, JSON.stringify(priceAlerts.slice(-200)));
  }, [preferencesLoaded, priceAlerts]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(SHOW_RECENT_HIGHS_KEY, showRecentHighs ? "1" : "0");
  }, [preferencesLoaded, showRecentHighs]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(SHOW_FRACTALS_KEY, showFractals ? "1" : "0");
  }, [preferencesLoaded, showFractals]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(SHOW_GHOST_PIVOT_KEY, showGhostPivot ? "1" : "0");
  }, [preferencesLoaded, showGhostPivot]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(SINGLE_RESOLUTION_KEY, singleResolution);
  }, [preferencesLoaded, singleResolution]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(QUAD_SLOTS_KEY, JSON.stringify(quadSlots));
  }, [preferencesLoaded, quadSlots]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(WATCHLISTS_KEY, JSON.stringify(watchlists));
  }, [preferencesLoaded, watchlists]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(ACTIVE_WATCHLIST_KEY, activeWatchlistId);
  }, [activeWatchlistId, preferencesLoaded]);

  useEffect(() => {
    if (watchlists.some((list) => list.id === activeWatchlistId)) return;
    setActiveWatchlistId(watchlists[0]?.id ?? DEFAULT_WATCHLIST_ID);
  }, [activeWatchlistId, watchlists]);

  useEffect(() => {
    setActiveSymbol(initialSymbol);
  }, [initialSymbol]);

  useEffect(() => {
    function handleCommandK(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSymbolInput(activeSymbol);
      window.requestAnimationFrame(() => {
        symbolInputRef.current?.focus();
        symbolInputRef.current?.select();
      });
    }

    document.addEventListener("keydown", handleCommandK);
    return () => document.removeEventListener("keydown", handleCommandK);
  }, [activeSymbol]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadRobTopStocks() {
      setRobTopStocks((current) => ({
        status: "loading",
        symbols: current.symbols,
        error: null,
        updatedAt: current.updatedAt,
        updatedByEmail: current.updatedByEmail,
      }));
      try {
        const data = await fetchRobTopStocks(controller.signal);
        if (cancelled) return;
        setRobTopStocks({
          status: "ready",
          symbols: data.symbols,
          error: null,
          updatedAt: data.updatedAt,
          updatedByEmail: data.updatedByEmail,
        });
        setRobListDraft(data.symbols.join("\n"));
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setRobTopStocks((current) => ({
          status: "error",
          symbols: current.symbols,
          error: error instanceof Error ? error.message : "Rob's List unavailable.",
          updatedAt: current.updatedAt,
          updatedByEmail: current.updatedByEmail,
        }));
      }
    }

    void loadRobTopStocks();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadViewer() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setViewer({ status: "ready", email: null });
          return;
        }
        const data = (await response.json()) as { email?: unknown };
        if (!cancelled) {
          setViewer({ status: "ready", email: typeof data.email === "string" ? data.email.toLowerCase() : null });
        }
      } catch {
        if (!cancelled) setViewer({ status: "ready", email: null });
      }
    }

    void loadViewer();
    return () => {
      cancelled = true;
    };
  }, []);

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
        const data = await fetchScanner("intraday", controller.signal);
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
    let controller: AbortController | null = null;

    async function load(showLoading: boolean) {
      controller?.abort();
      controller = new AbortController();
      if (showLoading) {
        setLongTermScanner((current) => ({ status: "loading", data: current.data, error: null }));
      }
      try {
        const data = await fetchScanner("longTerm", controller.signal);
        if (!cancelled) setLongTermScanner({ status: "ready", data, error: null });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setLongTermScanner((current) => ({
          status: "error",
          data: current.data,
          error: error instanceof Error ? error.message : "Long-term scanner unavailable.",
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
    let controller: AbortController | null = null;

    async function load(showLoading: boolean) {
      controller?.abort();
      controller = new AbortController();
      if (showLoading) {
        setTopGainers((current) => ({ status: "loading", data: current.data, error: null }));
      }
      try {
        const data = await fetchTopGainersWatchlist(controller.signal);
        if (!cancelled) setTopGainers({ status: "ready", data, error: null });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setTopGainers((current) => ({
          status: "error",
          data: current.data,
          error: error instanceof Error ? error.message : "Top gainers unavailable.",
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

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const symbol = activeSymbol;

    setCompanyInfo((current) => ({
      status: "loading",
      fundamentals: current.fundamentals?.ticker === symbol ? current.fundamentals : null,
      snapshot: null,
      news: current.news?.ticker === symbol ? current.news : null,
      error: null,
    }));

    async function loadCompanyInfo() {
      const [fundamentalsResult, snapshotResult, newsResult] = await Promise.allSettled([
        fetch(`/api/command2/askedgar-summary?ticker=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
          signal: controller.signal,
        }).then(async (response) => {
          const json = await response.json().catch(() => null) as unknown;
          if (!response.ok) {
            const error = json && typeof json === "object" && "error" in json && typeof json.error === "string"
              ? json.error
              : "Unable to load fundamentals.";
            throw new Error(error);
          }
          return json as CompanyFundamentals;
        }),
        fetch(`/api/command/ticker?symbol=${encodeURIComponent(symbol)}`, {
          cache: "no-store",
          signal: controller.signal,
        }).then(async (response) => {
          const json = await response.json().catch(() => null) as unknown;
          if (!response.ok) throw new Error("Unable to load market snapshot.");
          return json as CompanySnapshot;
        }),
        fetch(`/api/command/news?tickers=${encodeURIComponent(symbol)}&limit=1`, {
          cache: "no-store",
          signal: controller.signal,
        }).then(async (response) => {
          const json = await response.json().catch(() => null) as { items?: CompanyNewsItem[] } | null;
          if (!response.ok) throw new Error("Unable to load news.");
          return Array.isArray(json?.items) ? json.items[0] ?? null : null;
        }),
      ]);

      if (cancelled) return;
      const fundamentals = fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value : null;
      const snapshot = snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
      const news = newsResult.status === "fulfilled" ? newsResult.value : null;
      const errors = [
        fundamentalsResult.status === "rejected" ? fundamentalsResult.reason : null,
        snapshotResult.status === "rejected" ? snapshotResult.reason : null,
        newsResult.status === "rejected" ? newsResult.reason : null,
      ].filter((error): error is Error => error instanceof Error);

      if (fundamentals || snapshot || news) {
        setCompanyInfo({ status: "ready", fundamentals, snapshot, news, error: null });
        return;
      }

      setCompanyInfo({
        status: "error",
        fundamentals,
        snapshot,
        news,
        error: errors[0]?.message ?? "Company info unavailable.",
      });
    }

    void loadCompanyInfo();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeSymbol]);

  const scannerRows = useMemo(() => symbolRowsFromScanner(scanner.data, rvolSortMode), [scanner.data, rvolSortMode]);
  const topGainerRows = useMemo(
    () => symbolRowsFromGainers(topGainers.data, topGainersSortMode),
    [topGainers.data, topGainersSortMode],
  );
  const activeWatchlist = useMemo(
    () => watchlists.find((list) => list.id === activeWatchlistId) ?? watchlists[0] ?? DEFAULT_WATCHLISTS[0],
    [activeWatchlistId, watchlists],
  );
  const myList = activeWatchlist.symbols;
  const allSignalHits = useMemo(
    () => [...(scanner.data?.hits ?? []), ...(longTermScanner.data?.hits ?? [])],
    [longTermScanner.data, scanner.data],
  );
  const signalHitsByKey = useMemo(() => {
    const map = new Map<string, RvolScannerHit[]>();
    for (const hit of allSignalHits) {
      if (hit.resolution !== "1m" && hit.resolution !== "5m" && hit.resolution !== "4h") continue;
      const key = signalHitKey(hit.ticker, hit.resolution);
      const hits = map.get(key) ?? [];
      hits.push(hit);
      map.set(key, hits);
    }
    for (const hits of map.values()) {
      hits.sort((a, b) => a.signalUnixSeconds - b.signalUnixSeconds);
    }
    return map;
  }, [allSignalHits]);
  const priceAlertsBySymbol = useMemo(() => {
    const map = new Map<string, PriceAlert[]>();
    for (const alert of priceAlerts) {
      const group = map.get(alert.symbol) ?? [];
      group.push(alert);
      map.set(alert.symbol, group);
    }
    for (const group of map.values()) {
      group.sort((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
    }
    return map;
  }, [priceAlerts]);

  useEffect(() => {
    quadChartsRef.current = quadCharts;
  }, [quadCharts]);

  useEffect(() => {
    if (viewMode === "quad") return;
    quadSlotRequestKeysRef.current = {};
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "quad") return;
    let cancelled = false;
    let controller: AbortController | null = null;
    const nextRequestKeys = Object.fromEntries(
      quadSlots.map((slot) => [slot.id, quadSlotRequestKey(slot)]),
    );
    const previousRequestKeys = quadSlotRequestKeysRef.current;
    const slotsToLoad = quadSlots.filter((slot) => {
      const currentChart = quadChartsRef.current[slot.id];
      return previousRequestKeys[slot.id] !== nextRequestKeys[slot.id] ||
        currentChart?.status !== "ready" ||
        currentChart.data.ticker !== slot.symbol ||
        currentChart.data.resolution !== slot.resolution;
    });
    const activeSlotIds = new Set(quadSlots.map((slot) => slot.id));
    quadSlotRequestKeysRef.current = nextRequestKeys;

    setQuadCharts((current) => {
      let changed = false;
      const next: Record<string, SingleChartState> = {};
      for (const slot of quadSlots) {
        if (current[slot.id]) {
          next[slot.id] = current[slot.id];
        }
      }
      if (Object.keys(current).length !== Object.keys(next).length) changed = true;
      return changed ? next : current;
    });

    async function load(slots: ChartSlot[], showLoading: boolean) {
      if (slots.length === 0) return;
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      if (showLoading) {
        setQuadCharts((current) => {
          const next: Record<string, SingleChartState> = {};
          for (const slot of quadSlots) {
            const currentState = current[slot.id];
            next[slot.id] = slots.some((candidate) => candidate.id === slot.id)
              ? { status: "loading", data: currentState?.data, error: null }
              : currentState ?? { status: "loading", data: undefined, error: null };
          }
          return next;
        });
      }
      const settled = await Promise.allSettled(
        slots.map(async (slot) => [slot.id, await fetchChart(slot.symbol, slot.resolution, currentController.signal)] as const),
      );
      if (cancelled || currentController.signal.aborted || controller !== currentController) return;

      setQuadCharts((current) => {
        const next: Record<string, SingleChartState> = {};
        for (const slot of quadSlots) {
          if (current[slot.id]) next[slot.id] = current[slot.id];
        }
        settled.forEach((result, index) => {
          const slot = slots[index];
          if (!activeSlotIds.has(slot.id)) return;
          if (result.status === "fulfilled") {
            next[slot.id] = { status: "ready", data: result.value[1], error: null };
            return;
          }
          next[slot.id] = {
            status: "error",
            data: current[slot.id]?.data,
            error: result.reason instanceof Error ? result.reason.message : "Unable to load chart.",
          };
        });
        return next;
      });
    }

    void load(slotsToLoad, true);
    const id = window.setInterval(() => void load(quadSlots, false), REFRESH_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(id);
    };
  }, [quadSlots, viewMode]);

  const activeScannerHit = useMemo(
    () => scannerRows.find((row) => row.ticker === activeSymbol) ?? null,
    [activeSymbol, scannerRows],
  );
  const activeAlertHit = useMemo(
    () =>
      [...allSignalHits]
        .filter((hit) => hit.ticker === activeSymbol)
        .sort((a, b) => b.signalUnixSeconds - a.signalUnixSeconds)[0] ?? null,
    [activeSymbol, allSignalHits],
  );
  const activeMonthlyPivotTarget = useMemo(
    () => monthlyPivotForSymbol(allSignalHits, activeSymbol),
    [activeSymbol, allSignalHits],
  );
  const activeMonthlyPivotLevels = useMemo(
    () => monthlyPivotsForSymbol(allSignalHits, activeSymbol),
    [activeSymbol, allSignalHits],
  );
  const activePosition = useMemo(
    () => positions.positions.find((position) => position.symbol.toUpperCase() === activeSymbol) ?? null,
    [activeSymbol, positions.positions],
  );
  const primaryPayload = charts.data["1m"];
  const activeLastBar = lastBar(primaryPayload);
  const activeFirstBar = firstRegularBar(primaryPayload);
  const lastPrice = activeScannerHit?.priceNow ?? activeLastBar?.close ?? Number(activePosition?.current_price);
  const numericLastPrice = typeof lastPrice === "number" && Number.isFinite(lastPrice) ? lastPrice : null;
  const changePct =
    activeScannerHit?.changePct ??
    (activeLastBar && activeFirstBar ? ((activeLastBar.close - activeFirstBar.close) / activeFirstBar.close) * 100 : null);
  const activeCompany = activeScannerHit?.name ?? "LONGBOARD STACK";
  const activePriceAlerts = priceAlertsBySymbol.get(activeSymbol) ?? [];
  const globalAlertCount = scannerRows.length + priceAlerts.filter((alert) => alert.status === "active").length;
  const palette = STACK_CHART_PALETTES[chartTheme];
  const annotationsByChart = useMemo(() => {
    const map = new Map<string, ChartAnnotation[]>();
    for (const annotation of annotations) {
      const key = chartAnnotationKey(annotation.symbol, annotation.resolution);
      const group = map.get(key) ?? [];
      group.push(annotation);
      map.set(key, group);
    }
    return map;
  }, [annotations]);
  const visibleAnnotationKeys = useMemo(() => {
    if (viewMode === "quad") {
      return new Set(quadSlots.map((slot) => chartAnnotationKey(slot.symbol, slot.resolution)));
    }
    if (viewMode === "single") {
      return new Set([chartAnnotationKey(activeSymbol, singleResolution)]);
    }
    return new Set(RESOLUTIONS.map((item) => chartAnnotationKey(activeSymbol, item.value)));
  }, [activeSymbol, quadSlots, singleResolution, viewMode]);

  useEffect(() => {
    if (scannerRows.length === 0) return;
    const nextKeys = new Set(scannerRows.map(rvolAlertKey));
    const hasNewAlert = scannerRows.some((hit) => !seenRvolAlertKeysRef.current.has(rvolAlertKey(hit)));

    if (!scannerSoundReadyRef.current) {
      seenRvolAlertKeysRef.current = nextKeys;
      scannerSoundReadyRef.current = true;
      return;
    }

    if (rvolSoundEnabled && hasNewAlert) {
      try {
        playRvolAlertSound();
      } catch {
        // Browsers may reject audio until a direct user gesture enables it.
      }
    }
    seenRvolAlertKeysRef.current = nextKeys;
  }, [rvolSoundEnabled, scannerRows]);

  useEffect(() => {
    if (numericLastPrice == null) return;
    const now = new Date().toISOString();

    setPriceAlerts((current) => {
      let changed = false;
      const next = current.map((alert) => {
        if (alert.symbol !== activeSymbol || alert.status === "triggered") return alert;
        const hit = alert.direction === "above"
          ? numericLastPrice >= alert.price
          : numericLastPrice <= alert.price;
        if (!hit) return alert;
        changed = true;
        return {
          ...alert,
          status: "triggered" as const,
          triggeredAt: now,
          triggerPrice: numericLastPrice,
        };
      });
      return changed ? next : current;
    });
  }, [activeSymbol, numericLastPrice, priceAlerts]);

  useEffect(() => {
    const triggeredIds = new Set(
      priceAlerts
        .filter((alert) => alert.status === "triggered")
        .map((alert) => alert.id),
    );
    const hasNewTrigger = [...triggeredIds].some((id) => !seenPriceAlertTriggerIdsRef.current.has(id));

    if (!priceAlertSoundReadyRef.current) {
      seenPriceAlertTriggerIdsRef.current = triggeredIds;
      priceAlertSoundReadyRef.current = true;
      return;
    }

    if (hasNewTrigger) {
      try {
        playRvolAlertSound();
      } catch {
        // Browsers may reject audio until the user has interacted with the page.
      }
    }
    seenPriceAlertTriggerIdsRef.current = triggeredIds;
  }, [priceAlerts]);

  function setWatchlistSource(tab: WatchlistTab) {
    setWatchlistTab(tab);
    if (preferencesLoaded) {
      window.localStorage.setItem(WATCHLIST_TAB_KEY, tab);
    }
  }

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
    const normalized = normalizeTicker(watchlistInput);
    if (!normalized) return;
    updateActiveWatchlist((symbols) => Array.from(new Set([normalized, ...symbols])).slice(0, 120));
    setWatchlistSource("myList");
    setWatchlistInput("");
    selectSymbol(normalized);
  }

  function removeMyListSymbol(symbol: string) {
    updateActiveWatchlist((symbols) => symbols.filter((item) => item !== symbol));
  }

  function updateActiveWatchlist(updater: (symbols: string[]) => string[]) {
    setWatchlists((current) =>
      current.map((list) =>
        list.id === activeWatchlist.id
          ? { ...list, symbols: uniqueSymbols(updater(list.symbols)) }
          : list,
      ),
    );
  }

  function createWatchlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newWatchlistName.trim() || `List ${watchlists.length + 1}`;
    const id = `list-${Date.now().toString(36)}`;
    setWatchlists((current) => [...current, { id, name, symbols: [] }]);
    setActiveWatchlistId(id);
    setWatchlistSource("myList");
    setNewWatchlistName("");
  }

  function importCsvTickers(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const imported = parseTickerCsv(text);
      if (imported.length === 0) return;
      updateActiveWatchlist((symbols) => uniqueSymbols([...imported, ...symbols]));
      setWatchlistSource("myList");
    }).finally(() => {
      event.target.value = "";
    });
  }

  function toggleRvolSound() {
    setRvolSoundEnabled((current) => {
      const next = !current;
      if (next) {
        try {
          playRvolAlertSound();
        } catch {
          // The toggle state is still useful if the browser suppresses the preview tone.
        }
      }
      return next;
    });
  }

  function addAnnotation(annotation: ChartAnnotation) {
    setAnnotations((current) => normalizeAnnotations([...current, annotation]));
  }

  function updateAnnotation(annotation: ChartAnnotation) {
    setAnnotations((current) => normalizeAnnotations(current.map((item) => (
      item.id === annotation.id ? annotation : item
    ))));
  }

  function removeAnnotation(id: string) {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
  }

  function clearVisibleAnnotations() {
    if (!window.confirm("Clear drawings on the visible chart view?")) return;
    setAnnotations((current) =>
      current.filter((annotation) => !visibleAnnotationKeys.has(chartAnnotationKey(annotation.symbol, annotation.resolution))),
    );
    setDrawingTool("pan");
  }

  function addPriceAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = Number(priceAlertInput);
    if (!Number.isFinite(price) || price <= 0) return;
    const direction: PriceAlertDirection = numericLastPrice == null || price >= numericLastPrice ? "above" : "below";
    setPriceAlerts((current) => normalizePriceAlerts([
      {
        id: makePriceAlertId(),
        symbol: activeSymbol,
        price,
        direction,
        status: "active",
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]));
    setPriceAlertInput("");
  }

  function removePriceAlert(id: string) {
    setPriceAlerts((current) => current.filter((alert) => alert.id !== id));
  }

  function resetTriggeredPriceAlerts() {
    setPriceAlerts((current) =>
      current.map((alert) =>
        alert.symbol === activeSymbol && alert.status === "triggered"
          ? { ...alert, status: "active", triggeredAt: undefined, triggerPrice: undefined }
          : alert,
      ),
    );
  }

  function moveWatchlistSymbol(source: string, target: string) {
    if (source === target) return;
    updateActiveWatchlist((symbols) => {
      const next = symbols.filter((symbol) => symbol !== source);
      const targetIndex = next.indexOf(target);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, source);
      return next;
    });
  }

  function handleWatchlistDrop(event: DragEvent<HTMLDivElement>, target: string) {
    event.preventDefault();
    const source = draggedSymbol ?? normalizeTicker(event.dataTransfer.getData("text/plain"));
    if (source) moveWatchlistSymbol(source, target);
    setDraggedSymbol(null);
  }

  function updateQuadSlot(slotId: string, patch: Partial<Omit<ChartSlot, "id">>) {
    setQuadSlots((current) =>
      current.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              ...patch,
              symbol: patch.symbol ? normalizeTicker(patch.symbol) ?? slot.symbol : slot.symbol,
            }
          : slot,
      ),
    );
  }

  function setSingleSymbol(symbol: string) {
    selectSymbol(symbol);
  }

  async function submitRobList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const symbols = parseRobTopStocksText(robListDraft);
    setRobListSaving(true);
    setRobListMessage(null);
    try {
      const data = await saveRobTopStocks(symbols);
      setRobTopStocks({
        status: "ready",
        symbols: data.symbols,
        error: null,
        updatedAt: data.updatedAt,
        updatedByEmail: data.updatedByEmail,
      });
      setRobListDraft(data.symbols.join("\n"));
      setRobListEditing(false);
      setRobListMessage("SAVED");
    } catch (error) {
      setRobListMessage(error instanceof Error ? error.message.toUpperCase() : "SAVE FAILED");
    } finally {
      setRobListSaving(false);
    }
  }

  function cancelRobListEdit() {
    setRobListDraft(robTopStocks.symbols.join("\n"));
    setRobListEditing(false);
    setRobListMessage(null);
  }

  function renderRobTopStocks() {
    const isRobListEditor = viewer.email === ROB_TOP_STOCKS_EDITOR_EMAIL;
    return (
      <div className="stack-watchlist__rows">
        <div className="stack-shared-list-meta">
          <div>
            <b>ROB&apos;S TOP STOCKS</b>
            <span>UNIVERSAL · {robTopStocks.symbols.length} SYMBOLS</span>
          </div>
          {isRobListEditor && !robListEditing && (
            <button type="button" onClick={() => setRobListEditing(true)}>
              EDIT
            </button>
          )}
        </div>
        {robListEditing && (
          <form className="stack-rob-list-editor" onSubmit={submitRobList}>
            <textarea
              value={robListDraft}
              onChange={(event) => setRobListDraft(event.target.value)}
              aria-label="Rob's list symbols"
              spellCheck={false}
              autoCapitalize="characters"
            />
            <div className="stack-rob-list-editor__actions">
              <button type="submit" disabled={robListSaving}>
                {robListSaving ? "SAVING" : "SAVE"}
              </button>
              <button type="button" onClick={cancelRobListEdit} disabled={robListSaving}>
                CANCEL
              </button>
            </div>
          </form>
        )}
        {robListMessage && <p className="stack-rail-message">{robListMessage}</p>}
        {robTopStocks.status === "loading" && <p className="stack-rail-message">LOADING ROB&apos;S LIST</p>}
        {robTopStocks.status === "error" && <p className="stack-rail-message">{robTopStocks.error}</p>}
        {robTopStocks.symbols.map((symbol, index) => (
          <button
            key={symbol}
            type="button"
            className={symbol === activeSymbol ? "stack-watch-row is-active" : "stack-watch-row"}
            onClick={() => selectSymbol(symbol)}
          >
            <span className="rank">{index + 1}</span>
            <span className="ticker">
              <b>{symbol}</b>
              <em>ROB&apos;S LIST</em>
            </span>
            <span className="price">
              <b>VIEW</b>
              <em>CHART</em>
            </span>
          </button>
        ))}
      </div>
    );
  }

  function renderTopGainerRow(row: PolygonTickerSnapshot, index: number) {
    const price = row.day?.c ?? null;
    const volume = row.day?.v ?? null;
    const updatedAt = formatGainerUpdatedAt(row.updated);
    return (
      <button
        key={row.ticker}
        type="button"
        className={row.ticker === activeSymbol ? "stack-watch-row is-active" : "stack-watch-row"}
        onClick={() => selectSymbol(row.ticker)}
      >
        <span className="rank">{index + 1}</span>
        <span className="ticker">
          <b>{row.ticker}</b>
          <em>{updatedAt} · {compactNullable(volume)} VOL</em>
        </span>
        <span className="price">
          <b>{money(price)}</b>
          <em>{pct(row.todaysChangePerc)}</em>
        </span>
      </button>
    );
  }

  function renderTopGainers() {
    return (
      <div className="stack-watchlist__rows">
        <div className="stack-shared-list-meta">
          <b>TOP GAINERS</b>
          <span>
            {gainerModeLabel(topGainers.data?.mode)} · {formatFetchedAt(topGainers.data?.fetchedAt)}
          </span>
        </div>
        <div className="stack-gainers-tools">
          <select
            value={topGainersSortMode}
            onChange={(event) => setTopGainersSortMode(event.target.value as TopGainersSortMode)}
            aria-label="Top gainers sort"
          >
            <option value="updated">TIME, THEN GAIN</option>
            <option value="gain">GAIN, THEN TIME</option>
          </select>
        </div>
        {topGainerRows.map(renderTopGainerRow)}
        {topGainers.status === "loading" && <p className="stack-rail-message">LOADING GAINERS</p>}
        {topGainers.status === "error" && <p className="stack-rail-message">{topGainers.error}</p>}
        {topGainers.status === "ready" && topGainerRows.length === 0 && <p className="stack-rail-message">NO GAINERS</p>}
      </div>
    );
  }

  const positionPnl = activePosition ? Number(activePosition.unrealized_pl) : null;
  const positionPnlPct = activePosition ? Number(activePosition.unrealized_plpc) * 100 : null;

  return (
    <main className={`stack-page stack-page--${chartTheme}`}>
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
              ref={symbolInputRef}
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value)}
              placeholder="SYMBOL"
              aria-label="Chart symbol"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </form>
          <button
            type="button"
            className="stack-theme-toggle"
            aria-pressed={chartTheme === "light"}
            aria-label={`Switch to ${chartTheme === "dark" ? "light" : "dark"} chart theme`}
            onClick={() => setChartTheme((current) => (current === "dark" ? "light" : "dark"))}
          >
            <span>THEME</span>
            <b>{chartTheme}</b>
          </button>
          <div className="stack-view-tabs" role="tablist" aria-label="Chart view">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "stack"}
              onClick={() => setViewMode("stack")}
            >
              3 TIMEFRAMES
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "quad"}
              onClick={() => setViewMode("quad")}
            >
              4 SYMBOLS
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "single"}
              onClick={() => setViewMode("single")}
            >
              1 CHART
            </button>
          </div>
          <div className="stack-drawing-tools" role="toolbar" aria-label="Chart drawing tools">
            <button
              type="button"
              aria-pressed={drawingTool === "pan"}
              onClick={() => setDrawingTool("pan")}
            >
              PAN
            </button>
            <button
              type="button"
              aria-pressed={drawingTool === "crosshair"}
              title="Crosshair candle inspector"
              onClick={() => setDrawingTool("crosshair")}
            >
              XHAIR
            </button>
            <button
              type="button"
              aria-pressed={drawingTool === "arrow"}
              onClick={() => setDrawingTool("arrow")}
            >
              ARROW
            </button>
            <button
              type="button"
              aria-pressed={drawingTool === "text"}
              onClick={() => setDrawingTool("text")}
            >
              TEXT
            </button>
            <button
              type="button"
              aria-pressed={drawingTool === "erase"}
              onClick={() => setDrawingTool("erase")}
            >
              ERASE
            </button>
            <button
              type="button"
              onClick={clearVisibleAnnotations}
              disabled={annotations.length === 0}
            >
              CLEAR
            </button>
          </div>
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
                onClick={() => setWatchlistSource("rvol")}
              >
                RVOL
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={watchlistTab === "robTop"}
                onClick={() => setWatchlistSource("robTop")}
              >
                ROB&apos;S LIST
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={watchlistTab === "topGainers"}
                onClick={() => setWatchlistSource("topGainers")}
              >
                GAINERS
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={watchlistTab === "myList"}
                onClick={() => setWatchlistSource("myList")}
              >
                MY LIST
              </button>
            </div>

            {watchlistTab === "rvol" && (
              <div className="stack-watchlist__rows">
                <div className="stack-rvol-tools">
                  <select
                    value={rvolSortMode}
                    onChange={(event) => setRvolSortMode(event.target.value as RvolSortMode)}
                    aria-label="RVOL scanner sort"
                  >
                    <option value="recent">RECENT</option>
                    <option value="move">MOVE</option>
                  </select>
                  <button
                    type="button"
                    aria-pressed={rvolSoundEnabled}
                    onClick={toggleRvolSound}
                  >
                    SOUND {rvolSoundEnabled ? "ON" : "OFF"}
                  </button>
                </div>
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
                      <em>{row.signalTimeEt} / {row.resolution.toUpperCase()}</em>
                    </span>
                    <span className="price">
                      <b>{money(row.priceNow)}</b>
                      <em>{rvolSortMode === "recent" ? `${row.signalRvol.toFixed(1)}X` : pct(row.changePct)}</em>
                    </span>
                  </button>
                ))}
                {scanner.status === "loading" && <p className="stack-rail-message">LOADING SCANNER</p>}
                {scanner.status === "error" && <p className="stack-rail-message">{scanner.error}</p>}
                {scanner.status === "ready" && scannerRows.length === 0 && <p className="stack-rail-message">NO SIGNALS</p>}
              </div>
            )}
            {watchlistTab === "robTop" && renderRobTopStocks()}
            {watchlistTab === "topGainers" && renderTopGainers()}
            {watchlistTab === "myList" && (
              <div className="stack-watchlist__rows">
                <div className="stack-watchlist-tools">
                  <select
                    value={activeWatchlist.id}
                    onChange={(event) => setActiveWatchlistId(event.target.value)}
                    aria-label="Watchlist"
                  >
                    {watchlists.map((list) => (
                      <option key={list.id} value={list.id}>{list.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => csvInputRef.current?.click()}
                  >
                    IMPORT CSV
                  </button>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="stack-file-input"
                    onChange={importCsvTickers}
                    aria-label="Import watchlist CSV"
                  />
                </div>
                <form className="stack-list-add stack-list-add--new" onSubmit={createWatchlist}>
                  <input
                    value={newWatchlistName}
                    onChange={(event) => setNewWatchlistName(event.target.value)}
                    placeholder="NEW LIST"
                    aria-label="New watchlist name"
                    spellCheck={false}
                  />
                  <button type="submit" aria-label="Create watchlist">+</button>
                </form>
                <form className="stack-list-add" onSubmit={addMyListSymbol}>
                  <input
                    value={watchlistInput}
                    onChange={(event) => setWatchlistInput(event.target.value)}
                    placeholder="ADD"
                    aria-label="Add symbol"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                  <button type="submit" aria-label="Add symbol">+</button>
                </form>
                {myList.map((symbol) => (
                  <div
                    key={symbol}
                    className={[
                      "stack-watch-row",
                      "stack-watch-row--managed",
                      symbol === activeSymbol ? "is-active" : "",
                      draggedSymbol === symbol ? "is-dragging" : "",
                    ].filter(Boolean).join(" ")}
                    draggable
                    onDragStart={(event) => {
                      setDraggedSymbol(symbol);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", symbol);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => handleWatchlistDrop(event, symbol)}
                    onDragEnd={() => setDraggedSymbol(null)}
                  >
                    <button
                      type="button"
                      className="stack-watch-main"
                      onClick={() => {
                        setWatchlistSource("myList");
                        selectSymbol(symbol);
                      }}
                    >
                      <span className="rank stack-drag-handle">::</span>
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

          <section className="stack-rail__panel stack-company-info">
            <div className="stack-company-info__header">
              <h2>{activeSymbol} INFO</h2>
              {companyInfo.status === "loading" && <span>LOADING</span>}
            </div>
            <div className="stack-company-metrics">
              <div>
                <span>FLOAT</span>
                <b>{compactNullable(companyInfo.fundamentals?.floatOutstanding)}</b>
              </div>
              <div>
                <span>MKT CAP</span>
                <b>{compactMoney(companyInfo.fundamentals?.marketCap ?? companyInfo.snapshot?.ticker.marketCap)}</b>
              </div>
              <div>
                <span>CASH</span>
                <b>{compactMoney(companyInfo.fundamentals?.estimatedCash)}</b>
              </div>
              <div>
                <span>RUNWAY</span>
                <b>
                  {typeof companyInfo.fundamentals?.cashRemainingMonths === "number"
                    ? `${companyInfo.fundamentals.cashRemainingMonths.toFixed(1)}M`
                    : "--"}
                </b>
              </div>
              <div>
                <span>AVG VOL 30D</span>
                <b>{compactNullable(companyInfo.snapshot?.ticker.averageVolume30d)}</b>
              </div>
            </div>
            <div className="stack-company-catalyst">
              <span>NEWS CATALYST</span>
              {companyInfo.news?.url ? (
                <a href={companyInfo.news.url} target="_blank" rel="noreferrer">
                  {companyInfo.news.title}
                </a>
              ) : (
                <p>{companyInfo.news?.title ?? (companyInfo.status === "error" ? companyInfo.error : "No fresh headline returned.")}</p>
              )}
              {companyInfo.news && (
                <em className="stack-company-catalyst-meta">
                  {[companyInfo.news.source ?? "News", formatNewsDate(companyInfo.news.published_utc)].filter(Boolean).join(" / ")}
                </em>
              )}
              {companyInfo.fundamentals?.cashNeed && (
                <em>{companyInfo.fundamentals.cashNeed} cash need</em>
              )}
            </div>
          </section>

          <section className="stack-rail__panel stack-alerts">
            <div className="stack-alerts__header">
              <h2>ALERTS</h2>
              {activePriceAlerts.some((alert) => alert.status === "triggered") && (
                <button type="button" onClick={resetTriggeredPriceAlerts}>RESET</button>
              )}
            </div>
            <form className="stack-alert-form" onSubmit={addPriceAlert}>
              <input
                value={priceAlertInput}
                onChange={(event) => setPriceAlertInput(event.target.value)}
                placeholder={numericLastPrice == null ? "PRICE" : money(numericLastPrice)}
                aria-label={`Alert price for ${activeSymbol}`}
                inputMode="decimal"
              />
              <button type="submit">ADD</button>
            </form>
            {activePriceAlerts.length > 0 ? (
              <div className="stack-alert-list">
                {activePriceAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={[
                      "stack-alert-row",
                      "stack-alert-row--managed",
                      alert.status === "triggered" ? "is-triggered" : "is-active",
                    ].join(" ")}
                  >
                    <i />
                    <span>
                      <b>{alert.direction.toUpperCase()} {money(alert.price)}</b>
                      <em>
                        {alert.status === "triggered"
                          ? `HIT ${formatFetchedAt(alert.triggeredAt)} @ ${money(alert.triggerPrice)}`
                          : `ARMED ${formatFetchedAt(alert.createdAt)}`}
                      </em>
                    </span>
                    <strong>{alert.status === "triggered" ? "DONE" : "LIVE"}</strong>
                    <button
                      type="button"
                      className="stack-remove"
                      aria-label={`Remove ${activeSymbol} alert ${money(alert.price)}`}
                      onClick={() => removePriceAlert(alert.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="stack-rail-message">NO PRICE ALERTS</p>
            )}
            {activeAlertHit && (
              <div className="stack-alert-row is-triggered">
                <i />
                <span>
                  <b>RVOL HIT {activeAlertHit.signalTimeEt}</b>
                  <em>{activeAlertHit.resolution} / {activeAlertHit.signalRvol.toFixed(1)}X</em>
                </span>
                <strong>{money(activeAlertHit.signalPrice)}</strong>
              </div>
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

        <section
          className={[
            "stack-grid",
            viewMode === "quad" ? "stack-grid--quad" : "",
            viewMode === "single" ? "stack-grid--single" : "",
          ].filter(Boolean).join(" ")}
          aria-label={
            viewMode === "quad"
              ? "Four configurable charts"
              : viewMode === "single"
                ? `${activeSymbol} single chart`
                : `${activeSymbol} chart stack`
          }
        >
          {charts.status === "error" && <div className="stack-error">{charts.error}</div>}
          {viewMode === "stack" ? (
            RESOLUTIONS.map((item) => (
              <StackChartPanel
                key={`${activeSymbol}-${item.value}`}
                payload={charts.data[item.value]}
                resolution={item.value}
                role={item.role}
                visibleBars={item.visibleBars}
                loading={charts.status === "loading" && !charts.data[item.value]}
                error={charts.status === "error" ? charts.error : null}
                palette={palette}
                signalHits={signalHitsByKey.get(signalHitKey(activeSymbol, item.value)) ?? EMPTY_SIGNAL_HITS}
                monthlyPivotTarget={item.value === "4h" ? activeMonthlyPivotTarget : null}
                monthlyPivotLevels={item.value === "4h" ? activeMonthlyPivotLevels : EMPTY_MONTHLY_PIVOTS}
                showRecentHighs={showRecentHighs}
                showFractals={showFractals}
                showGhostPivot={showGhostPivot}
                drawingTool={drawingTool}
                annotations={annotationsByChart.get(chartAnnotationKey(activeSymbol, item.value)) ?? []}
                priceAlerts={activePriceAlerts}
                onToggleRecentHighs={() => setShowRecentHighs((current) => !current)}
                onToggleFractals={() => setShowFractals((current) => !current)}
                onToggleGhostPivot={() => setShowGhostPivot((current) => !current)}
                onAddAnnotation={addAnnotation}
                onUpdateAnnotation={updateAnnotation}
                onRemoveAnnotation={removeAnnotation}
              />
            ))
          ) : viewMode === "quad" ? (
            quadSlots.map((slot) => {
              const chart = quadCharts[slot.id];
              const scannerHit = scannerRows.find((row) => row.ticker === slot.symbol);
              const slotMonthlyPivotTarget = monthlyPivotForSymbol(allSignalHits, slot.symbol);
              const slotMonthlyPivotLevels = monthlyPivotsForSymbol(allSignalHits, slot.symbol);
              return (
                <StackChartPanel
                  key={`${slot.id}-${slot.symbol}-${slot.resolution}`}
                  payload={chart?.data}
                  resolution={slot.resolution}
                  role={scannerHit ? `${scannerHit.signalRvol.toFixed(1)}X RVOL` : slot.resolution.toUpperCase()}
                  title={slot.symbol}
                  controls={
                    <ChartSlotControls
                      symbol={slot.symbol}
                      resolution={slot.resolution}
                      onSymbolChange={(symbol) => updateQuadSlot(slot.id, { symbol })}
                      onResolutionChange={(resolution) => updateQuadSlot(slot.id, { resolution })}
                    />
                  }
                  visibleBars={slot.resolution === "4h" ? 150 : 110}
                  loading={!chart || chart.status === "loading"}
                  error={chart?.status === "error" ? chart.error : null}
                  palette={palette}
                  signalHits={signalHitsByKey.get(signalHitKey(slot.symbol, slot.resolution)) ?? EMPTY_SIGNAL_HITS}
                  monthlyPivotTarget={slot.resolution === "4h" ? slotMonthlyPivotTarget : null}
                  monthlyPivotLevels={slot.resolution === "4h" ? slotMonthlyPivotLevels : EMPTY_MONTHLY_PIVOTS}
                  showRecentHighs={showRecentHighs}
                  showFractals={showFractals}
                  showGhostPivot={showGhostPivot}
                  drawingTool={drawingTool}
                  annotations={annotationsByChart.get(chartAnnotationKey(slot.symbol, slot.resolution)) ?? []}
                  priceAlerts={priceAlertsBySymbol.get(slot.symbol) ?? []}
                  onToggleRecentHighs={() => setShowRecentHighs((current) => !current)}
                  onToggleFractals={() => setShowFractals((current) => !current)}
                  onToggleGhostPivot={() => setShowGhostPivot((current) => !current)}
                  onAddAnnotation={addAnnotation}
                  onUpdateAnnotation={updateAnnotation}
                  onRemoveAnnotation={removeAnnotation}
                />
              );
            })
          ) : (
            <StackChartPanel
              key={`${activeSymbol}-single-${singleResolution}`}
              payload={charts.data[singleResolution]}
              resolution={singleResolution}
              role="FOCUS"
              title={activeSymbol}
              controls={
                <ChartSlotControls
                  symbol={activeSymbol}
                  resolution={singleResolution}
                  onSymbolChange={setSingleSymbol}
                  onResolutionChange={setSingleResolution}
                />
              }
              visibleBars={singleResolution === "4h" ? 180 : 150}
              loading={charts.status === "loading" && !charts.data[singleResolution]}
              error={charts.status === "error" ? charts.error : null}
              palette={palette}
              signalHits={signalHitsByKey.get(signalHitKey(activeSymbol, singleResolution)) ?? EMPTY_SIGNAL_HITS}
              monthlyPivotTarget={singleResolution === "4h" ? activeMonthlyPivotTarget : null}
              monthlyPivotLevels={singleResolution === "4h" ? activeMonthlyPivotLevels : EMPTY_MONTHLY_PIVOTS}
              showRecentHighs={showRecentHighs}
              showFractals={showFractals}
              showGhostPivot={showGhostPivot}
              drawingTool={drawingTool}
              annotations={annotationsByChart.get(chartAnnotationKey(activeSymbol, singleResolution)) ?? []}
              priceAlerts={activePriceAlerts}
              onToggleRecentHighs={() => setShowRecentHighs((current) => !current)}
              onToggleFractals={() => setShowFractals((current) => !current)}
              onToggleGhostPivot={() => setShowGhostPivot((current) => !current)}
              onAddAnnotation={addAnnotation}
              onUpdateAnnotation={updateAnnotation}
              onRemoveAnnotation={removeAnnotation}
            />
          )}
        </section>
      </div>
    </main>
  );
}
