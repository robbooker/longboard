"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResearchBrief } from "@/types/research";

type CachedRow = {
  ticker: string;
  as_of_date: string;
  rank: number | null;
  rank_reason: string | null;
  research: ResearchBrief;
  last_price: number | null;
  last_price_updated_at: string | null;
  created_at: string;
};

type CachedResponse = {
  rows: CachedRow[];
  asOfDate: string;
  isFallback: boolean;
};

type Me = { id: string; email: string; role: "user" | "admin" };

type Prices = Record<string, { last: number; at: string }>;

function fmtDollars(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtShares(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

export default function RankedResearchBlock() {
  const [data, setData] = useState<CachedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Prices>({});
  const [me, setMe] = useState<Me | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runErrors, setRunErrors] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showRunErrors, setShowRunErrors] = useState(false);

  // Once-per-mount auth probe so the admin-only Run Now button knows when
  // to render. Failure is silently ignored — non-admins just don't see it.
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.id) setMe(d as Me); })
      .catch(() => {});
  }, []);

  const loadCached = useCallback(async () => {
    try {
      const res = await fetch("/api/research/cached", { cache: "no-store" });
      if (!res.ok) throw new Error(`cached ${res.status}`);
      const d = (await res.json()) as CachedResponse;
      setData(d);
      setError(null);
      // Fire price refresh alongside so the cards fill with live Last
      // instead of the stale snapshot from the daily run.
      const tickers = d.rows.map((r) => r.ticker);
      if (tickers.length > 0) {
        fetch("/api/research/refresh-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickers }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((p) => { if (p?.prices) setPrices(p.prices as Prices); })
          .catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCached(); }, [loadCached]);

  async function runNow() {
    setRunning(true);
    setRunError(null);
    setRunErrors([]);
    try {
      const res = await fetch("/api/research/run-daily", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRunError(body?.message ?? body?.error ?? `HTTP ${res.status}`);
        return;
      }
      // Partial success — the run completed but some tickers fell out.
      // Preserve them in state so the UI can expose the detail below the
      // cards.
      if (Array.isArray(body?.errors) && body.errors.length > 0) {
        setRunErrors(body.errors as string[]);
      }
      await loadCached();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function refreshPrices() {
    if (!data || data.rows.length === 0) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const tickers = data.rows.map((r) => r.ticker);
      const res = await fetch("/api/research/refresh-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefreshError(body?.message ?? body?.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body?.prices) setPrices(body.prices as Prices);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  function toggleExpanded(ticker: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="border border-terminal-border bg-terminal-surface rounded-sm p-4 text-center">
        <span className="text-terminal-dim text-xs">loading ranked research…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-terminal-danger text-xs font-mono border border-terminal-danger/30 bg-terminal-danger/5 px-4 py-2 rounded-sm">
        ✗ {error}
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const asOfDate = data?.asOfDate ?? "";
  const isFallback = data?.isFallback ?? false;
  const isAdmin = me?.role === "admin";

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-terminal-text text-sm font-mono uppercase tracking-widest">
            Today&apos;s Small-Cap Movers — Ranked
          </h2>
          {asOfDate && (
            <div className="text-terminal-dim text-[10px] font-mono mt-1">
              as of {asOfDate}
            </div>
          )}
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={refreshPrices}
              disabled={refreshing || running}
              title="Re-fetch live prices only. Fast — no research run."
              className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 border border-terminal-border text-terminal-dim hover:text-terminal-accent hover:border-terminal-accent/50 transition-colors rounded-sm disabled:opacity-40"
            >
              {refreshing ? "Refreshing…" : "Refresh Prices"}
            </button>
            {isAdmin && (
              <button
                onClick={runNow}
                disabled={running || refreshing}
                title="Re-run full daily research + ranking. Slow — ~15–20s."
                className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 border border-terminal-border text-terminal-dim hover:text-terminal-accent hover:border-terminal-accent/50 transition-colors rounded-sm disabled:opacity-40"
              >
                {running ? "Running…" : "Run Now"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Refresh-prices error strip. Separate from run-errors so the user
          knows which button misbehaved. */}
      {refreshError && (
        <div className="text-terminal-danger text-xs font-mono border border-terminal-danger/30 bg-terminal-danger/5 px-3 py-2 rounded-sm">
          ✗ Price refresh failed: {refreshError}
        </div>
      )}

      {/* Stale cache banner */}
      {isFallback && asOfDate && (
        <div className="text-terminal-warn text-xs font-mono border border-terminal-warn/30 bg-terminal-warn/5 px-3 py-2 rounded-sm">
          Showing {asOfDate} data — today&apos;s daily run hasn&apos;t completed yet.
        </div>
      )}

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="border border-terminal-border bg-terminal-surface rounded-sm p-6 text-center space-y-3">
          <div className="text-terminal-dim text-xs font-mono">
            No research run today yet.
          </div>
          {isAdmin && (
            <div className="space-y-2">
              <button
                onClick={runNow}
                disabled={running}
                className="px-4 py-2 bg-terminal-surface border border-terminal-accent/50 text-terminal-accent font-mono text-xs tracking-widest hover:bg-terminal-accent/10 hover:border-terminal-accent transition-all disabled:opacity-30 rounded-sm"
              >
                {running ? "Running…" : "Run Now"}
              </button>
              {runError && (
                <div className="text-terminal-danger text-[11px] font-mono">
                  ✗ {runError}
                </div>
              )}
            </div>
          )}
          {!isAdmin && (
            <div className="text-terminal-dim text-[10px] font-mono">
              Admin will trigger the first run of the day.
            </div>
          )}
        </div>
      )}

      {/* Card list */}
      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <RankedCard
              key={row.ticker}
              row={row}
              livePrice={prices[row.ticker]?.last}
              isExpanded={expanded.has(row.ticker)}
              onToggle={() => toggleExpanded(row.ticker)}
            />
          ))}
        </div>
      )}

      {/* Run error surfaced at the top level when firing from the header button */}
      {runError && rows.length > 0 && (
        <div className="text-terminal-danger text-xs font-mono border border-terminal-danger/30 bg-terminal-danger/5 px-3 py-2 rounded-sm">
          ✗ Run failed: {runError}
        </div>
      )}

      {/* Partial-failure notice — run completed but some tickers fell out.
          Collapsed by default so the card list stays scannable; admin can
          expand to see the specific error strings. */}
      {runErrors.length > 0 && (
        <div className="text-terminal-warn text-xs font-mono border border-terminal-warn/30 bg-terminal-warn/5 rounded-sm">
          <button
            onClick={() => setShowRunErrors((v) => !v)}
            className="w-full text-left px-3 py-2 hover:bg-terminal-warn/10 transition-colors"
          >
            {showRunErrors ? "−" : "+"} {runErrors.length} ticker{runErrors.length > 1 ? "s" : ""} had issues during the last run
          </button>
          {showRunErrors && (
            <ul className="border-t border-terminal-warn/20 px-4 py-2 space-y-1 list-disc list-inside">
              {runErrors.map((err, i) => (
                <li key={i} className="text-[11px] text-terminal-warn/90 leading-relaxed break-all">{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RankedCard({
  row,
  livePrice,
  isExpanded,
  onToggle,
}: {
  row: CachedRow;
  livePrice: number | undefined;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const brief = row.research;
  const displayPrice = livePrice ?? row.last_price ?? brief.market?.price ?? null;
  const changePct = brief.market?.todayChangePct ?? null;
  const pctColor = changePct == null
    ? "text-terminal-dim"
    : changePct >= 0
      ? "text-terminal-accent"
      : "text-terminal-danger";

  // Rank-1 gets TZ-gold (brand accent, not theme — same #d4af37 used
  // elsewhere). Ranks 2+ use the dim/muted text color so #1 visually
  // dominates without being alone.
  const rankColor = row.rank === 1 ? "text-[#d4af37]" : "text-terminal-dim";
  const rankDisplay = row.rank != null ? `#${row.rank}` : "—";

  return (
    <div className="border border-terminal-border bg-terminal-surface rounded-sm overflow-hidden">
      {/* Card header row — ticker, rank, price, change */}
      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`font-mono text-lg font-semibold tracking-widest ${rankColor}`}>
              {rankDisplay}
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xl text-terminal-accent tracking-widest">
                  {row.ticker}
                </span>
                {brief.market?.companyName && (
                  <span className="text-terminal-dim text-xs font-mono truncate">
                    {brief.market.companyName}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right font-mono">
            <div className="text-terminal-text text-lg">{fmtPrice(displayPrice)}</div>
            <div className={`text-xs ${pctColor}`}>{fmtPct(changePct)}</div>
          </div>
        </div>

        {/* Rank reason */}
        {row.rank_reason && (
          <div className="text-terminal-text text-xs font-mono leading-relaxed pt-1">
            {row.rank_reason}
          </div>
        )}
      </div>

      {/* Expand toggle */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-2 border-t border-terminal-border text-terminal-dim hover:text-terminal-accent hover:bg-terminal-muted/30 transition-colors text-[10px] font-mono uppercase tracking-wider text-left"
      >
        {isExpanded ? "− hide research" : "+ show research"}
      </button>

      {/* Expanded full research */}
      {isExpanded && (
        <div className="border-t border-terminal-border px-4 py-3 space-y-3 text-xs font-mono">
          {brief.market && (
            <ResearchSection title="Market">
              <Kv label="Market cap" value={fmtDollars(brief.market.marketCap)} />
              <Kv label="Float" value={brief.market.float != null ? `${fmtShares(brief.market.float)} shares` : "—"} />
              <Kv label="Volume" value={fmtShares(brief.market.volume)} />
              <Kv label="Prev close" value={fmtPrice(brief.market.prevClose)} />
              <Kv label="Industry" value={brief.market.sicDescription ?? "—"} />
              <Kv label="HQ" value={brief.market.hqLocation ?? "—"} />
            </ResearchSection>
          )}
          {brief.fundamentals && (
            <ResearchSection title="Fundamentals">
              <Kv
                label="Latest filing"
                value={brief.fundamentals.form && brief.fundamentals.filingDate ? `${brief.fundamentals.form} — ${brief.fundamentals.filingDate}` : "—"}
              />
              <Kv label="Cash" value={fmtDollars(brief.fundamentals.cashOnHand)} />
              <Kv label="Revenue" value={fmtDollars(brief.fundamentals.revenue)} />
              <Kv label="Net income" value={fmtDollars(brief.fundamentals.netIncome)} />
              <Kv
                label="Going concern"
                value={brief.fundamentals.goingConcern === null ? "—" : brief.fundamentals.goingConcern ? "YES" : "No"}
                alert={brief.fundamentals.goingConcern === true}
              />
              <Kv
                label="Shelf (S-3)"
                value={brief.fundamentals.hasShelfRegistration ? `Yes · ${brief.fundamentals.shelfFilingDate ?? "?"}` : "No"}
                alert={brief.fundamentals.hasShelfRegistration}
              />
            </ResearchSection>
          )}
          {brief.news?.perplexitySummary && (
            <ResearchSection title="News">
              <div className="text-terminal-text leading-relaxed whitespace-pre-wrap">
                {brief.news.perplexitySummary}
              </div>
            </ResearchSection>
          )}
          {brief.errors.length > 0 && (
            <div className="text-terminal-warn text-[10px] leading-relaxed">
              {brief.errors.length} data source{brief.errors.length > 1 ? "s" : ""} had issues during research.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResearchSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-terminal-dim uppercase tracking-wider text-[10px] mb-1.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Kv({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-terminal-dim">{label}</span>
      <span className={alert ? "text-terminal-danger" : "text-terminal-text"}>{value}</span>
    </div>
  );
}
