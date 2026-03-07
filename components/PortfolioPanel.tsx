"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchPortfolio } from "@/lib/alpaca";
import { fetchTZPortfolio } from "@/lib/tradezero";
import type { PortfolioData } from "@/types/alpaca";
import type { TZPortfolioData } from "@/lib/tradezero";

const REFRESH_INTERVAL = 30_000;

type BrokerMode = "paper" | "live";

function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return num.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function formatPercent(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) * 100 : value * 100;
  const sign = num >= 0 ? "+" : "";
  return `${sign}${num.toFixed(2)}%`;
}

function plColor(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (num > 0) return "text-terminal-accent";
  if (num < 0) return "text-terminal-danger";
  return "text-terminal-dim";
}

function Spinner() {
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-terminal-warn font-mono text-sm">{frames[frame]}</span>
  );
}

function Metric({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div>
      <div className="text-terminal-dim text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-semibold font-mono ${colorClass || "text-terminal-text"}`}>{value}</div>
    </div>
  );
}

// ── Alpaca (Paper) Panel ─────────────────────────────────

function AlpacaPanel() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchPortfolio();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch portfolio");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, REFRESH_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        load();
        intervalRef.current = setInterval(load, REFRESH_INTERVAL);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [load]);

  const notConfigured = error?.includes("not configured");

  const dayPL = data
    ? (parseFloat(data.account.equity) - parseFloat(data.account.last_equity)).toFixed(2)
    : "0";
  const dayPLPct = data && parseFloat(data.account.last_equity) !== 0
    ? ((parseFloat(data.account.equity) - parseFloat(data.account.last_equity)) / parseFloat(data.account.last_equity)).toFixed(4)
    : "0";

  if (loading) return <div className="text-center py-12 space-y-2"><Spinner /><div className="text-terminal-dim text-xs">connecting to Alpaca...</div></div>;
  if (notConfigured) return <div className="text-terminal-warn text-xs border border-terminal-warn/30 bg-terminal-warn/5 px-4 py-3 rounded-sm">ALPACA: NOT CONFIGURED — add keys to .env.local</div>;
  if (error) return <div className="text-terminal-danger text-xs border border-terminal-danger/30 bg-terminal-danger/5 px-4 py-2 rounded-sm">✗ {error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="border border-terminal-border bg-terminal-surface rounded-sm p-4">
        <div className="grid grid-cols-2 gap-4">
          <Metric label="Equity" value={formatCurrency(data.account.equity)} />
          <Metric label="Buying Power" value={formatCurrency(data.account.buying_power)} />
          <Metric label="Cash" value={formatCurrency(data.account.cash)} />
          <Metric label="Day P&L" value={`${parseFloat(dayPL) >= 0 ? "+" : ""}${formatCurrency(dayPL)} (${formatPercent(dayPLPct)})`} colorClass={plColor(dayPL)} />
        </div>
      </div>

      <div className="border border-terminal-border bg-terminal-surface rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-terminal-border">
          <span className="text-terminal-dim text-xs uppercase tracking-wider">Positions ({data.positions.length})</span>
        </div>
        {data.positions.length === 0 ? (
          <div className="text-terminal-dim text-xs text-center py-8">no open positions</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs px-4">
              <thead>
                <tr className="text-terminal-dim uppercase tracking-wider border-b border-terminal-border">
                  <th className="text-left py-2 px-4 font-normal">Sym</th>
                  <th className="text-right py-2 pr-3 font-normal">Qty</th>
                  <th className="text-right py-2 pr-3 font-normal">Entry</th>
                  <th className="text-right py-2 pr-3 font-normal">Price</th>
                  <th className="text-right py-2 pr-3 font-normal">P&L</th>
                  <th className="text-right py-2 font-normal">P&L%</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((pos) => (
                  <tr key={pos.asset_id} className="border-b border-terminal-border hover:bg-terminal-muted/30 transition-colors">
                    <td className="py-2 px-4 text-terminal-accent font-semibold tracking-widest">{pos.symbol}</td>
                    <td className="py-2 pr-3 text-right">{pos.qty}</td>
                    <td className="py-2 pr-3 text-right text-terminal-dim">{formatCurrency(pos.avg_entry_price)}</td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(pos.current_price)}</td>
                    <td className={`py-2 pr-3 text-right ${plColor(pos.unrealized_pl)}`}>
                      {parseFloat(pos.unrealized_pl) >= 0 ? "+" : ""}{formatCurrency(pos.unrealized_pl)}
                    </td>
                    <td className={`py-2 text-right ${plColor(pos.unrealized_plpc)}`}>
                      {formatPercent(pos.unrealized_plpc)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TradeZero (Live) Panel ───────────────────────────────

function TradeZeroPanel() {
  const [data, setData] = useState<TZPortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchTZPortfolio();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch TradeZero");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, REFRESH_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        load();
        intervalRef.current = setInterval(load, REFRESH_INTERVAL);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [load]);

  const notConfigured = error?.includes("not configured");

  if (loading) return <div className="text-center py-12 space-y-2"><Spinner /><div className="text-terminal-dim text-xs">connecting to TradeZero...</div></div>;
  if (notConfigured) return <div className="text-terminal-warn text-xs border border-terminal-warn/30 bg-terminal-warn/5 px-4 py-3 rounded-sm">TRADEZERO: NOT CONFIGURED — add keys to .env.local</div>;
  if (error) return <div className="text-terminal-danger text-xs border border-terminal-danger/30 bg-terminal-danger/5 px-4 py-2 rounded-sm">✗ {error}</div>;
  if (!data) return null;

  const acct = data.account;
  const dayPL = acct.equity - acct.sodEquity;
  const dayPLPct = acct.sodEquity !== 0 ? dayPL / acct.sodEquity : 0;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="border border-terminal-border bg-terminal-surface rounded-sm p-4">
        <div className="grid grid-cols-2 gap-4">
          <Metric label="Equity" value={formatCurrency(acct.equity)} />
          <Metric label="Buying Power" value={formatCurrency(acct.buyingPower)} />
          <Metric label="Cash" value={formatCurrency(acct.availableCash)} />
          <Metric label="Day P&L" value={`${dayPL >= 0 ? "+" : ""}${formatCurrency(dayPL)} (${formatPercent(dayPLPct)})`} colorClass={plColor(dayPL)} />
        </div>
      </div>

      <div className="border border-terminal-border bg-terminal-surface rounded-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-terminal-border flex items-center justify-between">
          <span className="text-terminal-dim text-xs uppercase tracking-wider">Positions ({data.positions.length})</span>
          <span className="text-terminal-dim text-xs">{acct.account}</span>
        </div>
        {data.positions.length === 0 ? (
          <div className="text-terminal-dim text-xs text-center py-8">no open positions</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs px-4">
              <thead>
                <tr className="text-terminal-dim uppercase tracking-wider border-b border-terminal-border">
                  <th className="text-left py-2 px-4 font-normal">Sym</th>
                  <th className="text-right py-2 pr-3 font-normal">Qty</th>
                  <th className="text-right py-2 pr-3 font-normal">Side</th>
                  <th className="text-right py-2 pr-3 font-normal">Avg</th>
                  <th className="text-right py-2 font-normal">Type</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((pos) => (
                  <tr key={pos.symbol + pos.createdDate} className="border-b border-terminal-border hover:bg-terminal-muted/30 transition-colors">
                    <td className="py-2 px-4 text-terminal-accent font-semibold tracking-widest">{pos.symbol}</td>
                    <td className="py-2 pr-3 text-right">{pos.shares}</td>
                    <td className={`py-2 pr-3 text-right ${pos.side === "Long" ? "text-terminal-accent" : "text-terminal-danger"}`}>{pos.side}</td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(pos.priceAvg)}</td>
                    <td className="py-2 text-right text-terminal-dim">{pos.dayOvernight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Portfolio Panel ─────────────────────────────────

export default function PortfolioPanel() {
  const [mode, setMode] = useState<BrokerMode>("live");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setFetchedAt(new Date().toISOString()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="px-4 py-6 space-y-4 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-terminal-accent font-semibold tracking-widest text-base">PORTFOLIO</span>
          <div className="flex border border-terminal-border rounded-sm overflow-hidden text-xs">
            <button
              onClick={() => setMode("paper")}
              className={`px-2 py-0.5 transition-colors ${
                mode === "paper"
                  ? "bg-terminal-muted text-terminal-text"
                  : "text-terminal-dim hover:text-terminal-text"
              }`}
            >
              paper
            </button>
            <button
              onClick={() => setMode("live")}
              className={`px-2 py-0.5 transition-colors ${
                mode === "live"
                  ? "bg-terminal-accent/20 text-terminal-accent border-l border-terminal-border"
                  : "text-terminal-dim hover:text-terminal-text border-l border-terminal-border"
              }`}
            >
              live
            </button>
          </div>
        </div>
        {fetchedAt && (
          <span className="text-terminal-dim text-xs">
            {new Date(fetchedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>

      {mode === "paper" ? <AlpacaPanel /> : <TradeZeroPanel />}

      <div className="flex items-center justify-between text-xs text-terminal-dim">
        <span>auto-refresh: 30s</span>
        <div className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-terminal-accent animate-pulse" />
          <span>{mode === "paper" ? "Alpaca" : "TradeZero"}</span>
        </div>
      </div>
    </div>
  );
}
