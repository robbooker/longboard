"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import {
  createChart,
  CrosshairMode,
  LineStyle,
  ColorType,
} from "lightweight-charts";
import type { IChartApi, CandlestickData, Time } from "lightweight-charts";

/* ═══ Types ════════════════════════════════════════════════════════════ */

interface Trade {
  ticker: string;
  gap_date: string;
  gap_pct: number;
  bucket: string;
  entry_price: number;
  exit_price: number;
  open_price: number;
  drop_low: number;
  pnl: number;
  pyrs: number;
  deployed: number;
  reason: string;
}

interface MonthStats {
  n: number;
  wins: number;
  winRate: number;
  pnl: number;
  profitFactor: number;
  expectancy: number;
}

interface MonthData {
  stats: MonthStats;
  trades: Trade[];
}

interface DashboardData {
  config: { drop: number; pop: number; window: number; stop: number; exit: string; pyramid: string };
  months: Record<string, MonthData>;
}

interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartEntry {
  ticker: string;
  gap_date: string;
  month: string;
  bucket: string;
  win: boolean;
  bars: ChartBar[];
  open_price: number;
  drop_low: number;
  entry_price: number;
  exit_price: number;
  stop_price: number;
  pnl: number;
  reason: string;
  gap_pct: number;
  drop_low_ts: number | null;
  entry_ts: number | null;
  exit_ts: number | null;
}

type ChartDataMap = Record<string, ChartEntry>;

/* ═══ Theme system ═════════════════════════════════════════════════════ */

type ThemeName = "dark" | "light" | "blue" | "retro";

interface ThemeColors {
  bg: string; bg2: string; bgCard: string; bgHeader: string; bgStat: string;
  border: string; border2: string;
  t1: string; t2: string; t3: string; t4: string; t5: string;
  green: string; greenBg: string; greenBdr: string;
  red: string; redBg: string; redBdr: string;
  link: string;
  chartBg: string; gridColor: string;
  candleUp: string; candleDown: string;
  fontMono: string;
}

const THEMES: Record<ThemeName, ThemeColors> = {
  dark: {
    bg: "#0a0a0f", bg2: "#0e0e16", bgCard: "#12121e", bgHeader: "#12121a", bgStat: "#1a1a24",
    border: "#1e1e2e", border2: "#2a2a3e",
    t1: "#e0e0e0", t2: "#ccc", t3: "#aaa", t4: "#888", t5: "#666",
    green: "#4ade80", greenBg: "#0a1a0a", greenBdr: "#1a3a1a",
    red: "#f87171", redBg: "#1a0a0a", redBdr: "#3a1a1a",
    link: "#6b8afd",
    chartBg: "#0a0a0f", gridColor: "#1a1a24",
    candleUp: "#4ade80", candleDown: "#f87171",
    fontMono: "var(--font-micro)",
  },
  light: {
    bg: "#fafafa", bg2: "#f3f3f6", bgCard: "#eeeef2", bgHeader: "#eeeef2", bgStat: "#e4e4ea",
    border: "#d8d8e0", border2: "#c8c8d0",
    t1: "#1a1a2e", t2: "#333", t3: "#555", t4: "#777", t5: "#999",
    green: "#16a34a", greenBg: "#f0fdf4", greenBdr: "#bbf7d0",
    red: "#dc2626", redBg: "#fef2f2", redBdr: "#fecaca",
    link: "#4f46e5",
    chartBg: "#fafafa", gridColor: "#e4e4ea",
    candleUp: "#16a34a", candleDown: "#dc2626",
    fontMono: "var(--font-micro)",
  },
  blue: {
    bg: "#edf4fc", bg2: "#dde9f7", bgCard: "#d0e2f4", bgHeader: "#d0e2f4", bgStat: "#c0d6ee",
    border: "#8fbde0", border2: "#6faad4",
    t1: "#1a3654", t2: "#2a5070", t3: "#3a6890", t4: "#5a8ab4", t5: "#7aa4c8",
    green: "#059669", greenBg: "#ecfdf5", greenBdr: "#6ee7b7",
    red: "#dc2626", redBg: "#fff1f2", redBdr: "#fca5a5",
    link: "#2563eb",
    chartBg: "#edf4fc", gridColor: "#c0d6ee",
    candleUp: "#059669", candleDown: "#dc2626",
    fontMono: "var(--font-micro)",
  },
  retro: {
    bg: "#c0c0c0", bg2: "#d4d0c8", bgCard: "#ffffff", bgHeader: "#c0c0c0", bgStat: "#d4d0c8",
    border: "#808080", border2: "#a0a0a0",
    t1: "#000000", t2: "#000000", t3: "#000080", t4: "#333", t5: "#666",
    green: "#008000", greenBg: "#c0ffc0", greenBdr: "#008000",
    red: "#ff0000", redBg: "#ffc0c0", redBdr: "#ff0000",
    link: "#0000ff",
    chartBg: "#ffffff", gridColor: "#c0c0c0",
    candleUp: "#008000", candleDown: "#ff0000",
    fontMono: "'Courier New', Courier, monospace",
  },
};

const THEME_DOTS: Record<ThemeName, string> = {
  dark: "#0a0a0f",
  light: "#fafafa",
  blue: "#a0c4e8",
  retro: "#ffff00",
};

/* ═══ Constants ════════════════════════════════════════════════════════ */

const MONTH_ORDER = ["November", "December", "January", "FebMar"] as const;
const CHART_MONTH_MAP: Record<string, string> = {
  November: "November",
  December: "December",
  January: "January",
  FebMar: "Feb-Mar",
};

const MONTH_TAG_STYLES: Record<string, { bg: string; color: string }> = {
  November: { bg: "#2d1b4e", color: "#a78bfa" },
  December: { bg: "#1b3a4e", color: "#67e8f9" },
  January: { bg: "#1b4e2d", color: "#6ee7b7" },
  "Feb-Mar": { bg: "#4e3a1b", color: "#fbbf24" },
};

function fmt(n: number): string {
  return `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`;
}

/* ═══ Flatten trades into a list with index ════════════════════════════ */

interface FlatTrade {
  trade: Trade;
  monthKey: string;
  chartKey: string;
  idx: number;
}

function flattenTrades(data: DashboardData): FlatTrade[] {
  const list: FlatTrade[] = [];
  for (const m of MONTH_ORDER) {
    const md = data.months[m];
    if (!md) continue;
    const sorted = [...md.trades].sort((a, b) => b.pnl - a.pnl);
    for (const t of sorted) {
      list.push({
        trade: t,
        monthKey: m,
        chartKey: `${t.ticker}_${t.gap_date}`,
        idx: list.length,
      });
    }
  }
  return list;
}

/* ═══ Main Page ════════════════════════════════════════════════════════ */

export default function DropAndPopPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [chartData, setChartData] = useState<ChartDataMap | null>(null);
  const [theme, setThemeState] = useState<ThemeName>("dark");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [monthFilter, setMonthFilter] = useState<string>("All");
  const [error, setError] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Theme persistence via localStorage
  useEffect(() => {
    const saved = localStorage.getItem("pop-drop-theme");
    if (saved && saved in THEMES) setThemeState(saved as ThemeName);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "pop-drop-theme" && e.newValue && e.newValue in THEMES) {
        setThemeState(e.newValue as ThemeName);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    localStorage.setItem("pop-drop-theme", t);
  };

  // Load data
  useEffect(() => {
    Promise.all([
      fetch("/drop_and_pop_dashboard_data.json").then((r) => r.json()),
      fetch("/drop_and_pop_chart_data.json").then((r) => r.json()),
    ])
      .then(([d, c]) => { setData(d); setChartData(c); })
      .catch((e) => setError(e.message));
  }, []);

  const allTrades = data ? flattenTrades(data) : [];
  const filteredTrades = monthFilter === "All"
    ? allTrades
    : allTrades.filter((ft) => ft.monthKey === monthFilter);

  // Clamp index
  const safeIdx = Math.min(currentIdx, Math.max(filteredTrades.length - 1, 0));
  const currentFt = filteredTrades[safeIdx] || null;
  const currentChart = currentFt && chartData ? chartData[currentFt.chartKey] : null;

  // Render chart
  const renderChart = useCallback(() => {
    if (!chartContainerRef.current || !currentChart) return;
    // Clear old chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const c = THEMES[theme];
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: c.chartBg },
        textColor: c.t5,
        fontFamily: c.fontMono,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: c.gridColor },
        horzLines: { color: c.gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: c.t4, width: 1, style: LineStyle.Dotted },
        horzLine: { color: c.t4, width: 1, style: LineStyle.Dotted },
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: c.border },
      rightPriceScale: { borderColor: c.border },
    });
    chartRef.current = chart;

    const series = chart.addCandlestickSeries({
      upColor: c.candleUp,
      downColor: c.candleDown,
      borderUpColor: c.candleUp,
      borderDownColor: c.candleDown,
      wickUpColor: c.candleUp + "aa",
      wickDownColor: c.candleDown + "aa",
    });

    series.setData(
      currentChart.bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
    );

    // Markers
    const markers: Array<{
      time: Time;
      position: "aboveBar" | "belowBar";
      color: string;
      shape: "arrowDown" | "arrowUp";
      text: string;
    }> = [];

    if (currentChart.drop_low_ts) {
      markers.push({
        time: currentChart.drop_low_ts as Time,
        position: "belowBar",
        color: "#fbbf24",
        shape: "arrowUp",
        text: `DROP $${currentChart.drop_low.toFixed(2)}`,
      });
    }

    if (currentChart.entry_ts) {
      markers.push({
        time: currentChart.entry_ts as Time,
        position: "belowBar",
        color: c.candleUp,
        shape: "arrowUp",
        text: `ENTRY $${currentChart.entry_price.toFixed(2)}`,
      });
    }

    if (currentChart.exit_ts) {
      const exitColor = currentChart.win ? c.candleUp : c.candleDown;
      markers.push({
        time: currentChart.exit_ts as Time,
        position: currentChart.win ? "aboveBar" : "belowBar",
        color: exitColor,
        shape: currentChart.win ? "arrowDown" : "arrowUp",
        text: `${currentChart.reason.toUpperCase()} $${currentChart.exit_price.toFixed(2)}`,
      });
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    series.setMarkers(markers);

    // Price lines
    if (currentChart.entry_price > 0) {
      series.createPriceLine({
        price: currentChart.entry_price,
        color: c.candleUp,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Entry",
      });
    }
    if (currentChart.stop_price > 0) {
      series.createPriceLine({
        price: currentChart.stop_price,
        color: c.candleDown,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "Stop",
      });
    }
    if (currentChart.exit_price > 0) {
      series.createPriceLine({
        price: currentChart.exit_price,
        color: "#60a5fa",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Exit",
      });
    }

    chart.timeScale().fitContent();
  }, [currentChart, theme]);

  useEffect(() => { renderChart(); }, [renderChart]);

  // Resize
  useEffect(() => {
    const handle = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  // Keyboard nav
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setCurrentIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setCurrentIdx((i) => Math.min(filteredTrades.length - 1, i + 1));
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [filteredTrades.length]);

  // Scroll active card into view
  useEffect(() => {
    const el = document.getElementById(`tl-${safeIdx}`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [safeIdx]);

  // Loading / error
  if (error) {
    return (
      <div style={{ background: "var(--bg)", color: "var(--text-primary)", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-micro)" }}>
        Error: {error}
      </div>
    );
  }
  if (!data || !chartData) {
    return (
      <div style={{ background: "var(--bg)", color: "var(--text-secondary)", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-micro)" }}>
        Loading...
      </div>
    );
  }

  const c = THEMES[theme];
  const isRetro = theme === "retro";
  const fontBody = "var(--font-display)";
  const radius = isRetro ? "0px" : "4px";

  const totalPnl = Object.values(data.months).reduce((s, m) => s + m.stats.pnl, 0);
  const totalTrades = Object.values(data.months).reduce((s, m) => s + m.stats.n, 0);
  const totalWins = Object.values(data.months).reduce((s, m) => s + m.stats.wins, 0);
  const totalWR = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : "0";

  const ct = currentFt?.trade;
  const cc = currentChart;
  const wl = ct && ct.pnl > 0 ? "winner" : "loser";
  const monthLabel = cc ? cc.month : currentFt ? CHART_MONTH_MAP[currentFt.monthKey] || currentFt.monthKey : "";
  const monthTagStyle = MONTH_TAG_STYLES[monthLabel] || { bg: "#333", color: "#aaa" };

  return (
    <div style={{ background: c.bg, color: c.t1, fontFamily: fontBody, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", transition: "background .3s, color .3s" }}>
      {/* Retro marquee */}
      {isRetro && (
        <div style={{ background: "var(--cream-3)", color: "var(--ink)", padding: "4px 0", fontFamily: "var(--font-micro)", fontSize: 14, fontWeight: 700, borderBottom: "1px solid var(--hairline)", overflow: "hidden", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", animation: "marquee 15s linear infinite" }}>
            &#9733; &#9733; &#9733; DROP &amp; POP TRADE VIEWER!!! &#9733; BEST VIEWED IN NETSCAPE NAVIGATOR 4.0 AT 800x600 &#9733; YOU ARE VISITOR #000,189 &#9733; &#9733; &#9733;
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", background: c.bgHeader, borderBottom: `1px solid ${c.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ fontFamily: c.fontMono, fontSize: 14, color: c.t4, fontWeight: 500, letterSpacing: 1, margin: 0 }}>
            DROP &amp; POP TRADE VIEWER
          </h1>
          <Link href="/" style={{ fontFamily: c.fontMono, fontSize: 11, color: c.link, textDecoration: "none", padding: "5px 12px", border: `1px solid ${c.border2}`, borderRadius: radius }}>
            HOME
          </Link>
          <Link href="/research/drop-and-pop/rules" style={{ fontFamily: c.fontMono, fontSize: 11, color: c.link, textDecoration: "none", padding: "5px 12px", border: `1px solid ${c.border2}`, borderRadius: radius }}>
            RULES &amp; RESULTS
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button disabled={safeIdx === 0} onClick={() => setCurrentIdx(safeIdx - 1)} style={{ background: c.bgStat, border: `1px solid ${c.border2}`, color: c.t3, padding: "6px 14px", borderRadius: radius, cursor: safeIdx === 0 ? "not-allowed" : "pointer", fontFamily: c.fontMono, fontSize: 12, opacity: safeIdx === 0 ? 0.3 : 1 }}>
            &larr; PREV
          </button>
          <select value={safeIdx} onChange={(e) => setCurrentIdx(Number(e.target.value))} style={{ background: c.bgStat, border: `1px solid ${c.border2}`, color: c.t2, padding: "6px 10px", borderRadius: radius, fontFamily: c.fontMono, fontSize: 12, maxWidth: 400 }}>
            {filteredTrades.map((ft, i) => (
              <option key={ft.chartKey + i} value={i}>
                {ft.trade.pnl >= 0 ? "W" : "L"} {ft.trade.ticker} {ft.trade.gap_date} {fmt(ft.trade.pnl)}
              </option>
            ))}
          </select>
          <button disabled={safeIdx >= filteredTrades.length - 1} onClick={() => setCurrentIdx(safeIdx + 1)} style={{ background: c.bgStat, border: `1px solid ${c.border2}`, color: c.t3, padding: "6px 14px", borderRadius: radius, cursor: safeIdx >= filteredTrades.length - 1 ? "not-allowed" : "pointer", fontFamily: c.fontMono, fontSize: 12, opacity: safeIdx >= filteredTrades.length - 1 ? 0.3 : 1 }}>
            NEXT &rarr;
          </button>

          {/* Month filter */}
          <select value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); setCurrentIdx(0); }} style={{ background: c.bgStat, border: `1px solid ${c.border2}`, color: c.t2, padding: "6px 10px", borderRadius: radius, fontFamily: c.fontMono, fontSize: 12 }}>
            <option value="All">All Months</option>
            {MONTH_ORDER.map((m) => (
              <option key={m} value={m}>{CHART_MONTH_MAP[m]}</option>
            ))}
          </select>

          {/* Theme switcher */}
          <div style={{ display: "flex", gap: 4, marginLeft: 12, borderLeft: `1px solid ${c.border}`, paddingLeft: 12 }}>
            {(["dark", "light", "blue", "retro"] as ThemeName[]).map((t) => (
              <button key={t} onClick={() => setTheme(t)} title={t} style={{
                width: 24, height: 24,
                borderRadius: t === "retro" ? 2 : "50%",
                border: `2px solid ${theme === t ? c.green : c.border2}`,
                background: t === "retro"
                  ? "repeating-linear-gradient(45deg,#ff0,#ff0 3px,#000 3px,#000 6px)"
                  : THEME_DOTS[t],
                cursor: "pointer",
                boxShadow: theme === t ? `0 0 8px ${c.green}` : "none",
                transition: "all .2s",
                padding: 0,
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ padding: "10px 16px", background: c.bgHeader, borderBottom: `1px solid ${c.border}`, display: "flex", gap: 20, fontFamily: c.fontMono, fontSize: 12 }}>
        <span style={{ color: c.t4 }}>Trades: <span style={{ color: c.t2, fontWeight: 700 }}>{filteredTrades.length}</span></span>
        <span style={{ color: c.t4 }}>Win Rate: <span style={{ color: c.t2, fontWeight: 700 }}>{totalWR}%</span></span>
        <span style={{ color: c.t4 }}>Total P&L: <span style={{ color: totalPnl >= 0 ? c.green : c.red, fontWeight: 700 }}>{fmt(totalPnl)}</span></span>
        <span style={{ color: c.t4 }}>Config: <span style={{ color: c.t2, fontWeight: 700 }}>d{data.config.drop}% p{data.config.pop}% w{data.config.window}m s{data.config.stop}% {data.config.exit}</span></span>
      </div>

      {/* Main: sidebar + chart */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <div ref={listRef} style={{ width: 320, minWidth: 320, background: c.bg2, borderRight: `1px solid ${c.border}`, overflowY: "auto", padding: 16 }}>
          {/* Trade card */}
          {ct && (
            <div style={{
              padding: 16,
              borderRadius: radius,
              marginBottom: 12,
              border: `1px solid ${wl === "winner" ? c.greenBdr : c.redBdr}`,
              background: wl === "winner" ? c.greenBg : c.redBg,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: c.fontMono, fontSize: 22, fontWeight: 700, color: wl === "winner" ? c.green : c.red }}>
                    {ct.ticker}
                  </div>
                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 3, fontSize: 10, fontFamily: c.fontMono, fontWeight: 700, letterSpacing: 1, background: monthTagStyle.bg, color: monthTagStyle.color }}>
                    {monthLabel.toUpperCase()}
                  </span>
                  {" "}
                  <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: radius, fontSize: 10, background: c.bgStat, color: c.t4, fontFamily: c.fontMono }}>
                    {ct.reason}
                  </span>
                </div>
                <div style={{ fontFamily: c.fontMono, fontSize: 20, fontWeight: 700, color: wl === "winner" ? c.green : c.red }}>
                  {fmt(ct.pnl)}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  ["GAP DATE", ct.gap_date],
                  ["GAP %", `${ct.gap_pct.toFixed(1)}%`],
                  ["OPEN", `$${ct.open_price.toFixed(2)}`],
                  ["DROP LOW", `$${ct.drop_low.toFixed(2)}`],
                  ["ENTRY (LONG)", `$${ct.entry_price.toFixed(2)}`],
                  ["STOP (25%)", cc ? `$${cc.stop_price.toFixed(2)}` : "—"],
                  ["EXIT", `$${ct.exit_price.toFixed(2)}`],
                  ["BUCKET", ct.bucket],
                  ["TRADE #", `${safeIdx + 1} / ${filteredTrades.length}`],
                  ["DEPLOYED", `$${ct.deployed.toLocaleString()}`],
                ].map(([label, val]) => (
                  <div key={label} style={{ padding: 8, background: c.bgStat, borderRadius: radius }}>
                    <div style={{ fontSize: 10, color: c.t5, textTransform: "uppercase", letterSpacing: 1, fontFamily: c.fontMono }}>{label}</div>
                    <div style={{ fontSize: 14, color: c.t2, fontFamily: c.fontMono, fontWeight: 500, marginTop: 2 }}>{val}</div>
                  </div>
                ))}
              </div>
              <a
                href={`https://www.tradingview.com/chart/?symbol=${ct.ticker}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", textAlign: "center", marginTop: 12, padding: 8, background: c.bgStat, border: `1px solid ${c.border2}`, borderRadius: radius, color: c.link, textDecoration: "none", fontFamily: c.fontMono, fontSize: 12 }}
              >
                Open {ct.ticker} on TradingView &rarr;
              </a>
            </div>
          )}

          {/* Trade list */}
          <div>
            {filteredTrades.map((ft, i) => {
              const isActive = i === safeIdx;
              const isW = ft.trade.pnl > 0;
              return (
                <div
                  key={ft.chartKey + i}
                  id={`tl-${i}`}
                  onClick={() => setCurrentIdx(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    borderRadius: radius,
                    cursor: "pointer",
                    fontFamily: c.fontMono,
                    fontSize: 11,
                    background: isActive ? c.bgCard : "transparent",
                    border: isActive ? `1px solid ${c.border2}` : "1px solid transparent",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = c.bgStat; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ width: 60, fontWeight: 700, color: isW ? c.green : c.red }}>{ft.trade.ticker}</span>
                  <span style={{ width: 80, color: c.t5 }}>{ft.trade.gap_date.slice(5)}</span>
                  <span style={{ width: 40, color: c.t5 }}>{ft.trade.gap_pct.toFixed(0)}%</span>
                  <span style={{ width: 70, textAlign: "right", fontWeight: 700, color: isW ? c.green : c.red }}>
                    {fmt(ft.trade.pnl)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chart */}
        <div ref={chartContainerRef} style={{ flex: 1, position: "relative" }} />
      </div>

      {/* Inline marquee animation for retro */}
      <style>{`@keyframes marquee { 0%{transform:translateX(100vw)} 100%{transform:translateX(-100%)} }`}</style>
    </div>
  );
}
