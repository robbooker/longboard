"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchGainers } from "@/lib/polygon";
import type { GainersData } from "@/types/polygon";
import type { ResearchBrief, AnalysisResult, StockAnalysis } from "@/types/research";

// ── Cache helpers ───────────────────────────────────────────────

const CACHE_PREFIX = "longboard_research_";

function cacheGet(ticker: string): { brief: ResearchBrief; cachedAt: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + ticker);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function cacheSet(brief: ResearchBrief) {
  try {
    localStorage.setItem(CACHE_PREFIX + brief.ticker, JSON.stringify({
      brief,
      cachedAt: new Date().toISOString(),
    }));
  } catch { /* storage full, ignore */ }
}

/** Only return briefs cached within the last 4 hours (same trading session) */
function cacheGetFresh(): ResearchBrief[] {
  const briefs: ResearchBrief[] = [];
  const cutoff = Date.now() - 4 * 60 * 60 * 1000; // 4 hours
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        const data = JSON.parse(localStorage.getItem(key)!);
        if (data?.brief && data?.cachedAt) {
          const cachedTime = new Date(data.cachedAt).getTime();
          if (cachedTime > cutoff) {
            briefs.push(data.brief);
          } else {
            // Stale — remove it
            localStorage.removeItem(key);
          }
        }
      }
    }
  } catch { /* ignore */ }
  return briefs;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ── Components ──────────────────────────────────────────────────

function Spinner() {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-terminal-warn font-mono text-sm">{frames[frame]}</span>
  );
}

// ── Formatters ──────────────────────────────────────────────────

function fmtDollars(n: number | null): string {
  if (n === null) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtShares(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtPct(n: number | null): string {
  if (n === null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function cleanPerplexityText(raw: string): string {
  let text = raw.replace(/\*\*/g, "");
  text = text.replace(/\[\d+\]/g, "");
  text = text.replace(/  +/g, " ");
  return text.trim();
}

// ── Analysis Card ───────────────────────────────────────────────

function AnalysisCard({ analysis, analysisResult }: { analysis: AnalysisResult; analysisResult: AnalysisResult }) {
  const isTopPick = (ticker: string) => analysisResult.topPick === ticker;

  return (
    <div className="animate-slide-up border border-terminal-accent/50 bg-terminal-surface rounded-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-terminal-border bg-terminal-accent/5">
        <div className="flex items-center justify-between">
          <span className="text-terminal-accent font-mono font-semibold text-sm uppercase tracking-widest">
            Claude Analysis
          </span>
          <span className="text-terminal-dim text-xs font-mono">
            {new Date(analysis.analyzedAt).toLocaleTimeString([], {
              hour: "2-digit", minute: "2-digit",
            })}
          </span>
        </div>
        {analysis.summary && (
          <div className="text-terminal-text text-sm font-mono mt-2 leading-relaxed">
            {analysis.summary}
          </div>
        )}
      </div>

      <div className="divide-y divide-terminal-border/50">
        {analysis.analyses.map((a) => (
          <div
            key={a.ticker}
            className={`px-4 py-3 ${isTopPick(a.ticker) ? "bg-terminal-accent/10 border-l-2 border-terminal-accent" : ""}`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-3">
                {isTopPick(a.ticker) && (
                  <span className="text-terminal-accent text-xs font-mono font-semibold px-1.5 py-0.5 border border-terminal-accent rounded-sm">
                    TOP PICK
                  </span>
                )}
                <span className="text-terminal-accent font-mono font-semibold tracking-widest">
                  {a.ticker}
                </span>
                <span
                  className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded-sm ${
                    a.signal === "buy"
                      ? "text-terminal-accent bg-terminal-accent/10 border border-terminal-accent/30"
                      : a.signal === "hold"
                      ? "text-terminal-warn bg-terminal-warn/10 border border-terminal-warn/30"
                      : "text-terminal-danger bg-terminal-danger/10 border border-terminal-danger/30"
                  }`}
                >
                  {a.signal.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                {a.targetPrice !== null && (
                  <span>
                    <span className="text-terminal-dim">Target: </span>
                    <span className="text-terminal-accent">${a.targetPrice.toFixed(2)}</span>
                  </span>
                )}
                {a.stopPrice !== null && (
                  <span>
                    <span className="text-terminal-dim">Stop: </span>
                    <span className="text-terminal-danger">${a.stopPrice.toFixed(2)}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="text-terminal-dim text-xs font-mono leading-relaxed">
              {a.reasoning}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Research Card ───────────────────────────────────────────────

function ResearchCard({
  brief,
  stockAnalysis,
  isTopPick,
  onRefresh,
  refreshing,
}: {
  brief: ResearchBrief;
  stockAnalysis?: StockAnalysis;
  isTopPick: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const hasErrors = brief.errors.length > 0;
  const cached = cacheGet(brief.ticker);
  const cachedAgo = cached ? timeAgo(cached.cachedAt) : null;

  return (
    <div className={`animate-slide-up border rounded-sm overflow-hidden ${
      isTopPick
        ? "border-terminal-accent bg-terminal-surface"
        : "border-terminal-border bg-terminal-surface"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
        <div className="flex items-center gap-3">
          {isTopPick && (
            <span className="text-terminal-accent text-xs font-mono font-semibold px-1.5 py-0.5 border border-terminal-accent rounded-sm">
              TOP PICK
            </span>
          )}
          <span className="text-terminal-accent font-mono font-semibold text-lg tracking-widest">
            ${brief.ticker}
          </span>
          {brief.market?.companyName && (
            <span className="text-terminal-dim text-xs font-mono truncate max-w-[200px]">
              {brief.market.companyName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Cached timestamp + refresh */}
          {cachedAgo && (
            <span className="text-terminal-dim text-xs font-mono">
              cached {cachedAgo}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="text-terminal-dim text-xs font-mono hover:text-terminal-accent transition-colors disabled:opacity-30"
            title="Refresh research"
          >
            {refreshing ? "..." : "refresh"}
          </button>
          {/* Status */}
          <div className="flex items-center text-xs font-mono">
            <span
              className={`inline-block w-2 h-2 rounded-full mr-2 ${
                brief.status === "complete"
                  ? "bg-terminal-accent"
                  : brief.status === "partial"
                  ? "bg-terminal-warn"
                  : "bg-terminal-danger"
              }`}
            />
            <span
              className={
                brief.status === "complete"
                  ? "text-terminal-accent"
                  : brief.status === "partial"
                  ? "text-terminal-warn"
                  : "text-terminal-danger"
              }
            >
              {brief.status === "complete"
                ? "complete"
                : brief.status === "partial"
                ? "partial"
                : "failed"}
            </span>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Claude analysis badge */}
        {stockAnalysis && (
          <div className={`flex items-center justify-between px-3 py-2 rounded-sm text-sm font-mono ${
            stockAnalysis.signal === "buy"
              ? "bg-terminal-accent/10 border border-terminal-accent/30"
              : stockAnalysis.signal === "hold"
              ? "bg-terminal-warn/10 border border-terminal-warn/30"
              : "bg-terminal-danger/10 border border-terminal-danger/30"
          }`}>
            <div className="flex items-center gap-3">
              <span className={`font-semibold ${
                stockAnalysis.signal === "buy" ? "text-terminal-accent"
                  : stockAnalysis.signal === "hold" ? "text-terminal-warn"
                  : "text-terminal-danger"
              }`}>
                {stockAnalysis.signal.toUpperCase()}
              </span>
              <span className="text-terminal-dim text-xs">{stockAnalysis.reasoning}</span>
            </div>
            <div className="flex items-center gap-4 text-xs shrink-0">
              {stockAnalysis.targetPrice !== null && (
                <span>
                  <span className="text-terminal-dim">T: </span>
                  <span className="text-terminal-accent">${stockAnalysis.targetPrice.toFixed(2)}</span>
                </span>
              )}
              {stockAnalysis.stopPrice !== null && (
                <span>
                  <span className="text-terminal-dim">S: </span>
                  <span className="text-terminal-danger">${stockAnalysis.stopPrice.toFixed(2)}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Company Info Bar */}
        {brief.market && (brief.market.hqLocation || brief.market.sicDescription) && (
          <div className="flex items-center gap-4 text-xs font-mono text-terminal-dim">
            {brief.market.hqLocation && (
              <span>HQ: {brief.market.hqLocation}</span>
            )}
            {brief.market.sicDescription && (
              <span className="truncate">{brief.market.sicDescription}</span>
            )}
          </div>
        )}

        {/* Market Data */}
        {brief.market && (
          <div>
            <div className="text-terminal-dim text-xs uppercase tracking-wider mb-2 font-mono">
              Market Data
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm font-mono">
              <div>
                <span className="text-terminal-dim">Price: </span>
                <span className="text-terminal-text">
                  {brief.market.price !== null ? `$${brief.market.price.toFixed(2)}` : "—"}
                </span>
              </div>
              <div>
                <span className="text-terminal-dim">Change: </span>
                <span
                  className={
                    brief.market.todayChangePct !== null && brief.market.todayChangePct >= 0
                      ? "text-terminal-accent"
                      : "text-terminal-danger"
                  }
                >
                  {brief.market.todayChange !== null
                    ? `${brief.market.todayChange >= 0 ? "+" : ""}$${brief.market.todayChange.toFixed(2)}`
                    : "—"}{" "}
                  ({fmtPct(brief.market.todayChangePct)})
                </span>
              </div>
              <div>
                <span className="text-terminal-dim">Prev Close: </span>
                <span className="text-terminal-text">
                  {brief.market.prevClose !== null ? `$${brief.market.prevClose.toFixed(2)}` : "—"}
                </span>
              </div>
              <div>
                <span className="text-terminal-dim">Mkt Cap: </span>
                <span className="text-terminal-text">{fmtDollars(brief.market.marketCap)}</span>
              </div>
              <div>
                <span className="text-terminal-dim">Float: </span>
                <span className="text-terminal-text">{fmtShares(brief.market.float)}</span>
              </div>
              <div>
                <span className="text-terminal-dim">Volume: </span>
                <span className="text-terminal-text">{fmtShares(brief.market.volume)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Fundamentals */}
        {brief.fundamentals && (
          <div>
            <div className="text-terminal-dim text-xs uppercase tracking-wider mb-2 font-mono">
              Fundamentals (EDGAR —{" "}
              {brief.fundamentals.form || "?"} filed{" "}
              {brief.fundamentals.filingDate || "?"})
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm font-mono mb-2">
              <div>
                <span className="text-terminal-dim">Cash: </span>
                <span className="text-terminal-text">
                  {fmtDollars(brief.fundamentals.cashOnHand)}
                </span>
              </div>
              <div>
                <span className="text-terminal-dim">Revenue: </span>
                <span className="text-terminal-text">
                  {fmtDollars(brief.fundamentals.revenue)}
                </span>
              </div>
              <div>
                <span className="text-terminal-dim">Net Income: </span>
                <span
                  className={
                    brief.fundamentals.netIncome !== null && brief.fundamentals.netIncome >= 0
                      ? "text-terminal-accent"
                      : "text-terminal-danger"
                  }
                >
                  {fmtDollars(brief.fundamentals.netIncome)}
                </span>
              </div>
            </div>
            <div className="text-sm font-mono space-y-1">
              {brief.fundamentals.goingConcern !== null && (
                <div>
                  <span className="text-terminal-dim">Going Concern: </span>
                  <span
                    className={
                      brief.fundamentals.goingConcern
                        ? "text-terminal-danger font-semibold"
                        : "text-terminal-accent"
                    }
                  >
                    {brief.fundamentals.goingConcern ? "YES — substantial doubt" : "No"}
                  </span>
                </div>
              )}
              <div>
                <span className="text-terminal-dim">Shelf (S-3): </span>
                <span
                  className={
                    brief.fundamentals.hasShelfRegistration
                      ? "text-terminal-warn"
                      : "text-terminal-dim"
                  }
                >
                  {brief.fundamentals.hasShelfRegistration
                    ? `Yes — filed ${brief.fundamentals.shelfFilingDate || "?"}`
                    : "None found"}
                </span>
              </div>
              {brief.fundamentals.liquidityExcerpt && (
                <details className="mt-2">
                  <summary className="text-terminal-dim text-xs cursor-pointer hover:text-terminal-text">
                    Liquidity & Capital Resources (click to expand)
                  </summary>
                  <pre className="mt-2 text-xs text-terminal-dim whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                    {brief.fundamentals.liquidityExcerpt.slice(0, 2000)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}

        {/* News / Catalyst */}
        {brief.news && (
          <div>
            <div className="text-terminal-dim text-xs uppercase tracking-wider mb-2 font-mono">
              News & Catalyst
            </div>
            {brief.news.perplexitySummary && (
              <div className="text-sm font-mono text-terminal-text leading-relaxed mb-3 whitespace-pre-line">
                {cleanPerplexityText(brief.news.perplexitySummary)}
              </div>
            )}
            {brief.news.exaResults.length > 0 && (
              <div className="mt-3 pt-3 border-t border-terminal-border/50">
                <div className="text-terminal-dim text-xs uppercase tracking-wider mb-2 font-mono">
                  Sources
                </div>
                <div className="space-y-1.5">
                  {brief.news.exaResults.map((r, i) => (
                    <div key={i} className="text-xs font-mono flex items-start gap-2">
                      <span className="text-terminal-dim shrink-0">[{i + 1}]</span>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-terminal-accent hover:underline truncate"
                      >
                        {r.title || r.url}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!brief.news.perplexitySummary && brief.news.exaResults.length === 0 && (
              <div className="text-terminal-dim text-sm font-mono">No recent news found.</div>
            )}
          </div>
        )}

        {/* Errors */}
        {hasErrors && (
          <div className="border-t border-terminal-border pt-3">
            <div className="text-terminal-danger text-xs font-mono space-y-1">
              {brief.errors.map((err, i) => (
                <div key={i}>✗ {err}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-terminal-border flex justify-between text-xs text-terminal-dim font-mono">
        <span>{brief.status === "complete" ? "3/3 layers" : `${[brief.market, brief.fundamentals, brief.news].filter(Boolean).length}/3 layers`}</span>
        <span>powered by Longboard</span>
      </div>
    </div>
  );
}

// ── Loading Card ────────────────────────────────────────────────

function LoadingCard({ ticker }: { ticker: string }) {
  return (
    <div className="animate-slide-up border border-terminal-border bg-terminal-surface rounded-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
        <div className="flex items-center gap-3">
          <span className="text-terminal-accent font-mono font-semibold text-lg tracking-widest">
            ${ticker}
          </span>
        </div>
        <div className="flex items-center text-xs font-mono text-terminal-warn">
          <Spinner />
          <span className="ml-2">researching...</span>
        </div>
      </div>
      <div className="p-4 text-center space-y-2">
        <div className="text-terminal-warn text-sm font-mono animate-pulse">
          pulling Polygon + EDGAR + Exa + Perplexity...
        </div>
        <div className="text-terminal-dim text-xs font-mono">
          this usually takes 5–15 seconds
        </div>
      </div>
    </div>
  );
}

// ── Top Gainers ─────────────────────────────────────────────────

const GAINERS_REFRESH = 60_000;

function TopGainers({
  onTickerClick,
  topPick,
  analysisMap,
}: {
  onTickerClick: (ticker: string) => void;
  topPick: string | null;
  analysisMap: Map<string, StockAnalysis>;
}) {
  const [data, setData] = useState<GainersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchGainers();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gainers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, GAINERS_REFRESH);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div className="border border-terminal-border bg-terminal-surface rounded-sm p-4 text-center">
        <Spinner />
        <span className="text-terminal-dim text-xs ml-2">loading gainers...</span>
      </div>
    );
  }

  if (error || !data) return null;

  const isEmpty = data.tickers.length === 0;

  return (
    <div className="animate-fade-in border border-terminal-border bg-terminal-surface rounded-sm overflow-hidden">
      <div className="px-4 py-2 border-b border-terminal-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-terminal-dim text-xs uppercase tracking-wider font-mono">
            Top Gainers
          </span>
          {data.mode === "pre-market" && (
            <span className="text-terminal-warn text-[10px] font-mono font-semibold px-1.5 py-0.5 border border-terminal-warn/30 rounded-sm">
              PRE-MARKET
            </span>
          )}
        </div>
        <span className="text-terminal-dim text-xs font-mono">
          {new Date(data.fetchedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      {isEmpty ? (
        <div className="px-4 py-6 text-center space-y-1">
          <div className="text-terminal-warn text-sm font-mono">
            No movers detected yet
          </div>
          <div className="text-terminal-dim text-xs font-mono">
            Waiting for pre-market activity. You can still research tickers manually above.
          </div>
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-terminal-dim uppercase tracking-wider border-b border-terminal-border">
              <th className="text-left py-1.5 px-4 font-normal">Ticker</th>
              <th className="text-right py-1.5 pr-4 font-normal">Price</th>
              <th className="text-right py-1.5 pr-4 font-normal">Chg</th>
              <th className="text-right py-1.5 pr-4 font-normal">%Chg</th>
              <th className="text-right py-1.5 pr-4 font-normal">Vol</th>
              {analysisMap.size > 0 && (
                <>
                  <th className="text-center py-1.5 pr-4 font-normal">Signal</th>
                  <th className="text-right py-1.5 pr-4 font-normal">Target</th>
                  <th className="text-right py-1.5 pr-4 font-normal">Stop</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {data.tickers.map((t) => {
              const isTop = topPick === t.ticker;
              const sa = analysisMap.get(t.ticker);
              return (
                <tr
                  key={t.ticker}
                  onClick={() => onTickerClick(t.ticker)}
                  className={`border-b border-terminal-border/50 hover:bg-terminal-muted/30 transition-colors cursor-pointer ${
                    isTop ? "bg-terminal-accent/10" : ""
                  }`}
                >
                  <td className="py-1.5 px-4 text-terminal-accent font-semibold tracking-widest">
                    {isTop && <span className="mr-1" title="Top Pick">*</span>}
                    {t.ticker}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-terminal-text">
                    ${t.day.c.toFixed(2)}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-terminal-accent">
                    +${t.todaysChange.toFixed(2)}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-terminal-accent">
                    +{t.todaysChangePerc.toFixed(2)}%
                  </td>
                  <td className="py-1.5 pr-4 text-right text-terminal-dim">
                    {t.day.v >= 1_000_000
                      ? (t.day.v / 1_000_000).toFixed(1) + "M"
                      : t.day.v >= 1_000
                      ? (t.day.v / 1_000).toFixed(1) + "K"
                      : t.day.v.toLocaleString()}
                  </td>
                  {analysisMap.size > 0 && (
                    <>
                      <td className="py-1.5 pr-4 text-center">
                        {sa ? (
                          <span className={`text-xs font-semibold ${
                            sa.signal === "buy" ? "text-terminal-accent"
                              : sa.signal === "hold" ? "text-terminal-warn"
                              : "text-terminal-danger"
                          }`}>
                            {sa.signal.toUpperCase()}
                          </span>
                        ) : (
                          <span className="text-terminal-dim">—</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-4 text-right text-terminal-accent">
                        {sa?.targetPrice ? `$${sa.targetPrice.toFixed(2)}` : "—"}
                      </td>
                      <td className="py-1.5 pr-4 text-right text-terminal-danger">
                        {sa?.stopPrice ? `$${sa.stopPrice.toFixed(2)}` : "—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────

export default function ResearchPanel() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingTicker, setLoadingTicker] = useState<string | null>(null);
  const [refreshingTicker, setRefreshingTicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<ResearchBrief[]>([]);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore only fresh cached briefs on mount (stale ones get purged)
  useEffect(() => {
    const fresh = cacheGetFresh();
    if (fresh.length > 0) {
      fresh.sort((a, b) => new Date(b.researchedAt).getTime() - new Date(a.researchedAt).getTime());
      setBriefs(fresh);
    }
    inputRef.current?.focus();
  }, []);

  // Build analysis map for gainers table
  const analysisMap = new Map<string, StockAnalysis>();
  if (analysisResult) {
    for (const a of analysisResult.analyses) {
      analysisMap.set(a.ticker, a);
    }
  }

  async function fetchResearch(tickerToFetch: string): Promise<ResearchBrief | null> {
    const res = await fetch(`/api/research?ticker=${encodeURIComponent(tickerToFetch)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    const brief: ResearchBrief = await res.json();
    cacheSet(brief);
    return brief;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = ticker.trim().toUpperCase();
    if (!clean) return;

    // Check cache first
    const cached = cacheGet(clean);
    if (cached) {
      // Already have it — still add to visible list if not there
      const exists = briefs.find((b) => b.ticker === clean);
      if (!exists) {
        setBriefs((prev) => [cached.brief, ...prev]);
      }
      setTicker("");
      // But still fetch fresh data in background
    }

    setLoading(true);
    setLoadingTicker(clean);
    setError(null);
    setTicker("");

    try {
      const brief = await fetchResearch(clean);
      if (brief) {
        setBriefs((prev) => {
          const filtered = prev.filter((b) => b.ticker !== clean);
          return [brief, ...filtered];
        });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to research ticker."
      );
    } finally {
      setLoading(false);
      setLoadingTicker(null);
      inputRef.current?.focus();
    }
  }

  async function handleRefresh(tickerToRefresh: string) {
    setRefreshingTicker(tickerToRefresh);
    try {
      const brief = await fetchResearch(tickerToRefresh);
      if (brief) {
        setBriefs((prev) =>
          prev.map((b) => (b.ticker === tickerToRefresh ? brief : b))
        );
      }
    } catch { /* ignore refresh errors */ }
    setRefreshingTicker(null);
  }

  async function handleAnalyze() {
    if (briefs.length === 0) return;
    setAnalyzing(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefs }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const result: AnalysisResult = await res.json();
      setAnalysisResult(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Analysis failed."
      );
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="px-6 py-10 space-y-6 max-w-3xl mx-auto">
      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-3 items-center">
        <div className="flex-1 flex items-center border border-terminal-border bg-terminal-surface rounded-sm px-4 py-3 gap-3 focus-within:border-terminal-accent transition-colors">
          <span className="text-terminal-accent font-mono text-sm select-none">$</span>
          <input
            ref={inputRef}
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z.]/g, ""))}
            placeholder="NVDA"
            maxLength={10}
            className="ticker-input flex-1 bg-transparent text-terminal-text font-mono text-lg tracking-widest outline-none"
            disabled={loading}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="characters"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !ticker.trim()}
          className="px-6 py-3 bg-terminal-surface border border-terminal-border text-terminal-accent font-mono text-sm tracking-widest hover:bg-terminal-muted hover:border-terminal-accent transition-all disabled:opacity-30 disabled:cursor-not-allowed rounded-sm"
        >
          {loading ? "..." : "RESEARCH"}
        </button>
      </form>

      {error && (
        <div className="text-terminal-danger text-xs font-mono border border-terminal-danger/30 bg-terminal-danger/5 px-4 py-2 rounded-sm">
          ✗ {error}
        </div>
      )}

      {/* Top Gainers */}
      <TopGainers
        onTickerClick={(t) => setTicker(t)}
        topPick={analysisResult?.topPick ?? null}
        analysisMap={analysisMap}
      />

      {/* Analyze Button */}
      {briefs.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleAnalyze}
            disabled={analyzing || briefs.length === 0}
            className="px-6 py-2 bg-terminal-surface border border-terminal-accent/50 text-terminal-accent font-mono text-sm tracking-widest hover:bg-terminal-accent/10 hover:border-terminal-accent transition-all disabled:opacity-30 disabled:cursor-not-allowed rounded-sm"
          >
            {analyzing ? (
              <span className="flex items-center gap-2">
                <Spinner /> ANALYZING...
              </span>
            ) : (
              `ANALYZE ${briefs.length} STOCK${briefs.length > 1 ? "S" : ""}`
            )}
          </button>
          <span className="text-terminal-dim text-xs font-mono">
            Claude picks the best trade
          </span>
        </div>
      )}

      {/* Loading Card */}
      {loading && loadingTicker && <LoadingCard ticker={loadingTicker} />}

      {/* Analysis Result */}
      {analysisResult && (
        <AnalysisCard analysis={analysisResult} analysisResult={analysisResult} />
      )}

      {/* Hint */}
      {briefs.length === 0 && !loading && (
        <div className="text-center py-16 text-terminal-dim font-mono text-sm space-y-2">
          <div>enter a ticker above</div>
          <div className="text-xs">Longboard will pull Polygon + EDGAR + Exa + Perplexity and return a full report</div>
        </div>
      )}

      {/* Results */}
      <div className="space-y-4">
        {briefs.map((b, i) => (
          <ResearchCard
            key={`${b.ticker}-${i}`}
            brief={b}
            stockAnalysis={analysisMap.get(b.ticker)}
            isTopPick={analysisResult?.topPick === b.ticker}
            onRefresh={() => handleRefresh(b.ticker)}
            refreshing={refreshingTicker === b.ticker}
          />
        ))}
      </div>
    </div>
  );
}
