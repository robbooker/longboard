"use client";

import { useEffect, useState } from "react";
import ThemeSetter from "@/components/ThemeSetter";
import Link from "next/link";

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
  config: {
    drop: number;
    pop: number;
    window: number;
    stop: number;
    exit: string;
    pyramid: string;
  };
  months: Record<string, MonthData>;
}

const MONTH_ORDER = ["November", "December", "January", "FebMar"];
const MONTH_LABELS: Record<string, string> = {
  November: "NOV",
  December: "DEC",
  January: "JAN",
  FebMar: "FEB-MAR",
};

const BUCKET_COLORS: Record<string, string> = {
  "10-25%": "bg-terminal-dim/30 text-terminal-dim",
  "25-50%": "bg-terminal-warn/20 text-terminal-warn",
  "50%+": "bg-terminal-accent/20 text-terminal-accent",
};

function fmt(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function StatBlock({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-terminal-dim uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-mono font-medium ${color || "text-terminal-text"}`}>{value}</span>
    </div>
  );
}

function MonthColumn({ monthKey, data, isWipeout }: { monthKey: string; data: MonthData; isWipeout: boolean }) {
  const { stats, trades } = data;
  const pnlColor = stats.pnl >= 0 ? "text-terminal-accent" : "text-terminal-danger";
  const headerBorder = isWipeout ? "border-terminal-danger/60" : "border-terminal-border";
  const headerBg = isWipeout ? "bg-terminal-danger/10" : "bg-terminal-surface";

  return (
    <div className="flex flex-col min-w-0 flex-1 border border-terminal-border rounded-sm overflow-hidden animate-fade-in">
      {/* Month header */}
      <div className={`px-4 py-3 border-b ${headerBorder} ${headerBg}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-semibold tracking-widest text-terminal-text">
            {MONTH_LABELS[monthKey]}
          </span>
          {monthKey === "November" && (
            <span className="text-[9px] font-mono text-terminal-dim border border-terminal-muted px-1.5 py-0.5 rounded-sm">
              TRAIN
            </span>
          )}
          {monthKey !== "November" && (
            <span className="text-[9px] font-mono text-terminal-dim border border-terminal-muted px-1.5 py-0.5 rounded-sm">
              OOS
            </span>
          )}
        </div>
        <div className={`text-lg font-mono font-semibold mt-1 ${pnlColor}`}>
          {fmt(stats.pnl)}
        </div>
      </div>

      {/* Stats row */}
      <div className="px-4 py-3 border-b border-terminal-border/50 grid grid-cols-2 gap-3">
        <StatBlock label="Trades" value={`${stats.n}`} />
        <StatBlock label="Win Rate" value={fmtPct(stats.winRate)} color={stats.winRate > 30 ? "text-terminal-accent" : stats.winRate === 0 ? "text-terminal-danger" : "text-terminal-warn"} />
        <StatBlock label="PF" value={stats.profitFactor > 0 ? stats.profitFactor.toFixed(2) : "0.00"} color={stats.profitFactor >= 1.5 ? "text-terminal-accent" : stats.profitFactor === 0 ? "text-terminal-danger" : "text-terminal-text"} />
        <StatBlock label="Exp" value={fmt(stats.expectancy)} color={stats.expectancy >= 0 ? "text-terminal-accent" : "text-terminal-danger"} />
      </div>

      {/* Trade list header */}
      <div className="px-3 py-1.5 border-b border-terminal-border/30 bg-terminal-bg">
        <div className="grid grid-cols-[56px_62px_40px_1fr_58px] gap-1 text-[9px] text-terminal-dim uppercase tracking-wider font-mono">
          <span>Ticker</span>
          <span>Date</span>
          <span>Gap</span>
          <span>Bucket</span>
          <span className="text-right">P&L</span>
        </div>
      </div>

      {/* Scrollable trade list */}
      <div className="flex-1 overflow-y-auto max-h-[420px]">
        {trades.map((t, i) => {
          const rowColor = t.pnl > 0
            ? "bg-terminal-accent/5 hover:bg-terminal-accent/10"
            : t.pnl < 0
            ? "bg-terminal-danger/5 hover:bg-terminal-danger/10"
            : "hover:bg-terminal-muted/20";
          const pnlTextColor = t.pnl > 0 ? "text-terminal-accent" : t.pnl < 0 ? "text-terminal-danger" : "text-terminal-dim";
          const bucketClass = BUCKET_COLORS[t.bucket] || "text-terminal-dim";

          return (
            <div
              key={`${t.ticker}-${t.gap_date}-${i}`}
              className={`px-3 py-1.5 border-b border-terminal-border/20 ${rowColor} transition-colors`}
            >
              <div className="grid grid-cols-[56px_62px_40px_1fr_58px] gap-1 items-center text-xs font-mono">
                <span className="text-terminal-text font-medium truncate">{t.ticker}</span>
                <span className="text-terminal-dim text-[10px]">{t.gap_date.slice(5)}</span>
                <span className="text-terminal-dim text-[10px]">{t.gap_pct.toFixed(0)}%</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-sm w-fit ${bucketClass}`}>
                  {t.bucket}
                </span>
                <span className={`text-right font-medium ${pnlTextColor}`}>
                  {t.pnl === 0 ? "$0" : fmt(t.pnl)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-terminal-border/50 bg-terminal-surface">
        <div className="flex justify-between text-[10px] font-mono text-terminal-dim">
          <span>{stats.wins}W / {stats.n - stats.wins}L</span>
          <span className={pnlColor}>{fmt(stats.pnl)}</span>
        </div>
      </div>
    </div>
  );
}

export default function DropAndPopPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/drop_and_pop_dashboard_data.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-terminal-bg flex items-center justify-center">
        <ThemeSetter theme="terminal" />
        <div className="text-terminal-danger font-mono text-sm">Error: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-terminal-bg flex items-center justify-center">
        <ThemeSetter theme="terminal" />
        <div className="text-terminal-dim font-mono text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  const totalOOS = (["December", "January", "FebMar"] as const).reduce(
    (sum, m) => sum + (data.months[m]?.stats.pnl || 0),
    0
  );

  return (
    <div className="min-h-screen bg-terminal-bg flex flex-col">
      <ThemeSetter theme="terminal" />

      {/* Header */}
      <header className="border-b border-terminal-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-terminal-accent text-xl font-mono font-semibold tracking-widest hover:text-terminal-accent/80 transition-colors">
            LONGBOARD
          </Link>
          <span className="text-terminal-dim text-xs font-mono">/</span>
          <span className="text-terminal-text text-xs font-mono border border-terminal-muted px-2 py-0.5 rounded-sm">
            drop &amp; pop
          </span>
        </div>
        <Link href="/" className="text-terminal-dim text-xs font-mono hover:text-terminal-text transition-colors">
          &larr; back
        </Link>
      </header>

      {/* Config strip */}
      <div className="border-b border-terminal-border/50 px-6 py-3 bg-terminal-surface">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="text-xs font-mono text-terminal-dim">
            <span className="text-terminal-text uppercase tracking-wider text-[10px]">Strategy</span>{" "}
            <span className="text-terminal-accent">LONG</span> — gapper drops then pops off the low
          </div>
          <div className="flex flex-wrap gap-3">
            {[
              ["Drop", `${data.config.drop}%`],
              ["Pop", `${data.config.pop}%`],
              ["Window", `${data.config.window}m`],
              ["Stop", `${data.config.stop}%`],
              ["Exit", data.config.exit],
              ["Pyramid", data.config.pyramid],
            ].map(([label, val]) => (
              <span key={label} className="text-[10px] font-mono text-terminal-dim">
                <span className="text-terminal-text">{label}</span>={val}
              </span>
            ))}
          </div>
          <div className="ml-auto text-xs font-mono">
            <span className="text-terminal-dim">OOS Total: </span>
            <span className={totalOOS >= 0 ? "text-terminal-accent font-medium" : "text-terminal-danger font-medium"}>
              {fmt(totalOOS)}
            </span>
          </div>
        </div>
      </div>

      {/* Month columns */}
      <main className="flex-1 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 h-full">
          {MONTH_ORDER.map((m) => {
            const monthData = data.months[m];
            if (!monthData) return null;
            const isWipeout = monthData.stats.winRate === 0 && monthData.stats.n > 5;
            return (
              <MonthColumn
                key={m}
                monthKey={m}
                data={monthData}
                isWipeout={isWipeout}
              />
            );
          })}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-terminal-border px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-terminal-dim">
          <span>Config #6 — d{data.config.drop}%_p{data.config.pop}%_w{data.config.window}m_s{data.config.stop}%_{data.config.exit}_{data.config.pyramid}</span>
          <span>Train: Nov 2025 | Validate: Dec 2025, Jan 2026, Feb-Mar 2026</span>
        </div>
      </footer>
    </div>
  );
}
