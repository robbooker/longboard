"use client";

import { useEffect, useMemo, useState } from "react";

type PolygonTickerSnapshot = {
  ticker?: string;
  todaysChangePerc?: number;
  day?: { c?: number; v?: number };
  prevDay?: { c?: number };
  companyName?: string;
};

type TopGainersResponse = {
  fetchedAt: string;
  tickers: PolygonTickerSnapshot[];
};

type Timeframe = "1" | "3" | "5";

function tfLabel(tf: Timeframe) {
  return tf === "1" ? "1m" : tf === "3" ? "3m" : "5m";
}

function tvSrc(symbol: string, interval: Timeframe) {
  const u = new URL("https://s.tradingview.com/widgetembed/");
  // Don't force an exchange prefix; top gainers can be NYSE/Nasdaq/AMEX.
  u.searchParams.set("symbol", symbol.toUpperCase());
  u.searchParams.set("interval", interval);
  u.searchParams.set("theme", "dark");
  u.searchParams.set("style", "1");
  u.searchParams.set("withdateranges", "1");
  u.searchParams.set("hideideas", "1");
  u.searchParams.set("hidesidetoolbar", "1");
  u.searchParams.set("saveimage", "0");
  u.searchParams.set("symboledit", "0");
  u.searchParams.set("toolbarbg", "rgba(0,0,0,0)");
  u.searchParams.set("studies", "");
  return u.toString();
}

function fmtPct(n: number | undefined) {
  if (!Number.isFinite(n)) return "—";
  const sign = (n ?? 0) >= 0 ? "+" : "";
  return `${sign}${(n ?? 0).toFixed(2)}%`;
}

function fmtMoney(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

type OpenTrade = {
  symbol: string;
  qty: number;
  avg: number;
  last: number;
};

function tradePnl(t: OpenTrade) {
  return (t.last - t.avg) * t.qty;
}

export function CommandManageClient() {
  const [tf, setTf] = useState<Timeframe>("1");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [rows, setRows] = useState<PolygonTickerSnapshot[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch("/api/command/manage/top-gainers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: TopGainersResponse | null) => {
        if (cancelled) return;
        const next = Array.isArray(j?.tickers) ? j!.tickers : [];
        setRows(next.slice(0, 4));
        setFetchedAt(typeof j?.fetchedAt === "string" ? j.fetchedAt : null);
        setStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setFetchedAt(null);
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const symbols = useMemo(() => {
    return rows.map((r) => (r.ticker || "").trim().toUpperCase()).filter(Boolean).slice(0, 4);
  }, [rows]);

  const openTrades: OpenTrade[] = useMemo(() => {
    // v1: static placeholder; will become user-specific once auth + brokerage sync lands.
    return [];
  }, []);

  return (
    <>
      <div className="cc-card" style={{ marginTop: 14 }}>
        <div className="cc-card-head" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>Open trades</strong>
          </div>
          <div style={{ color: "var(--cc-faint)" }}>positions + P&amp;L</div>
        </div>

        {openTrades.length === 0 ? (
          <div style={{ padding: 14, color: "var(--cc-dim)" }}>
            No open positions yet.
            <div style={{ marginTop: 8, color: "var(--cc-faint)" }}>
              Next: connect brokerage → show live qty, average, last, unrealized P&amp;L, then add stop/target controls.
            </div>
          </div>
        ) : (
          <div style={{ padding: 14 }}>
            <table className="cc-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Avg</th>
                  <th style={{ textAlign: "right" }}>Last</th>
                  <th style={{ textAlign: "right" }}>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map((t) => {
                  const pnl = tradePnl(t);
                  return (
                    <tr key={t.symbol}>
                      <td style={{ fontWeight: 900 }}>{t.symbol}</td>
                      <td style={{ textAlign: "right" }}>{t.qty}</td>
                      <td style={{ textAlign: "right" }}>${t.avg.toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>${t.last.toFixed(2)}</td>
                      <td style={{ textAlign: "right", color: pnl >= 0 ? "rgba(10, 143, 84, 0.95)" : "rgba(239, 68, 68, 0.92)" }}>
                        {fmtMoney(pnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cc-card" style={{ marginTop: 14 }}>
        <div className="cc-card-head" style={{ alignItems: "center" }}>
          <div>
            <strong>Charts</strong> · top 4 gainers
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="cc-seg" role="group" aria-label="Chart timeframe">
              {(["1", "3", "5"] as const).map((t) => (
                <button key={t} type="button" className={`cc-seg-btn ${tf === t ? "active" : ""}`} onClick={() => setTf(t)}>
                  {tfLabel(t)}
                </button>
              ))}
            </div>
            <div style={{ color: "var(--cc-faint)" }}>
              {status === "loading" ? "loading…" : status === "error" ? "error" : symbols.length ? `${symbols.length} charts` : "—"}
              {fetchedAt ? ` · ${new Date(fetchedAt).toLocaleTimeString()}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="cc-2col" style={{ marginTop: 14, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        {Array.from({ length: 4 }).map((_, i) => {
          const sym = symbols[i] ?? "";
          const row = rows[i] ?? null;
          return (
            <div key={i} className="cc-card" style={{ minWidth: 0 }}>
              <div className="cc-card-head" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", minWidth: 0 }}>
                  <div style={{ fontWeight: 900 }}>{sym || "—"}</div>
                  <div style={{ color: "var(--cc-dim)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
                    {fmtPct(row?.todaysChangePerc)}
                  </div>
                </div>
                <div style={{ color: "var(--cc-faint)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
                  top gainer
                </div>
              </div>

              {sym ? (
                <div className="cc-tv" style={{ paddingTop: "62%" }}>
                  <iframe
                    title={`${sym} chart`}
                    src={tvSrc(sym, tf)}
                    style={{ border: 0 }}
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div style={{ padding: 14, color: "var(--cc-dim)" }}>{status === "loading" ? "Loading top gainers…" : "No symbol."}</div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

type PolygonTickerSnapshot = {
  ticker?: string;
  todaysChangePerc?: number;
  day?: { c?: number; v?: number };
  prevDay?: { c?: number };
  companyName?: string;
};

type TopGainersResponse = {
  fetchedAt: string;
  tickers: PolygonTickerSnapshot[];
};

type Timeframe = "1" | "3" | "5";

function tfLabel(tf: Timeframe) {
  return tf === "1" ? "1m" : tf === "3" ? "3m" : "5m";
}

function tvSrc(symbol: string, interval: Timeframe) {
  const u = new URL("https://s.tradingview.com/widgetembed/");
  // Don't force an exchange prefix; top gainers can be NYSE/Nasdaq/AMEX.
  u.searchParams.set("symbol", symbol.toUpperCase());
  u.searchParams.set("interval", interval);
  u.searchParams.set("theme", "dark");
  u.searchParams.set("style", "1");
  u.searchParams.set("withdateranges", "1");
  u.searchParams.set("hideideas", "1");
  u.searchParams.set("hidesidetoolbar", "1");
  u.searchParams.set("saveimage", "0");
  u.searchParams.set("symboledit", "0");
  u.searchParams.set("toolbarbg", "rgba(0,0,0,0)");
  u.searchParams.set("studies", "");
  return u.toString();
}

function fmtPct(n: number | undefined) {
  if (!Number.isFinite(n)) return "—";
  const sign = (n ?? 0) >= 0 ? "+" : "";
  return `${sign}${(n ?? 0).toFixed(2)}%`;
}

function fmtMoney(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

type OpenTrade = {
  symbol: string;
  qty: number;
  avg: number;
  last: number;
};

function tradePnl(t: OpenTrade) {
  return (t.last - t.avg) * t.qty;
}

export function CommandManageClient() {
  const [tf, setTf] = useState<Timeframe>("1");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [rows, setRows] = useState<PolygonTickerSnapshot[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch("/api/command/manage/top-gainers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: TopGainersResponse | null) => {
        if (cancelled) return;
        const next = Array.isArray(j?.tickers) ? j!.tickers : [];
        setRows(next.slice(0, 4));
        setFetchedAt(typeof j?.fetchedAt === "string" ? j.fetchedAt : null);
        setStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setFetchedAt(null);
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const symbols = useMemo(() => {
    return rows.map((r) => (r.ticker || "").trim().toUpperCase()).filter(Boolean).slice(0, 4);
  }, [rows]);

  const openTrades: OpenTrade[] = useMemo(() => {
    // v1: static placeholder; will become user-specific once auth + brokerage sync lands.
    return [];
  }, []);

  return (
    <>
      <div className="cc-card" style={{ marginTop: 14 }}>
        <div className="cc-card-head" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>Open trades</strong>
          </div>
          <div style={{ color: "var(--cc-faint)" }}>positions + P&amp;L</div>
        </div>

        {openTrades.length === 0 ? (
          <div style={{ padding: 14, color: "var(--cc-dim)" }}>
            No open positions yet.
            <div style={{ marginTop: 8, color: "var(--cc-faint)" }}>
              Next: connect brokerage → show live qty, average, last, unrealized P&amp;L, then add stop/target controls.
            </div>
          </div>
        ) : (
          <div style={{ padding: 14 }}>
            <table className="cc-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Avg</th>
                  <th style={{ textAlign: "right" }}>Last</th>
                  <th style={{ textAlign: "right" }}>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map((t) => {
                  const pnl = tradePnl(t);
                  return (
                    <tr key={t.symbol}>
                      <td style={{ fontWeight: 900 }}>{t.symbol}</td>
                      <td style={{ textAlign: "right" }}>{t.qty}</td>
                      <td style={{ textAlign: "right" }}>${t.avg.toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>${t.last.toFixed(2)}</td>
                      <td style={{ textAlign: "right", color: pnl >= 0 ? "rgba(10, 143, 84, 0.95)" : "rgba(239, 68, 68, 0.92)" }}>
                        {fmtMoney(pnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="cc-card" style={{ marginTop: 14 }}>
        <div className="cc-card-head" style={{ alignItems: "center" }}>
          <div>
            <strong>Charts</strong> · top 4 gainers
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="cc-seg" role="group" aria-label="Chart timeframe">
              {(["1", "3", "5"] as const).map((t) => (
                <button key={t} type="button" className={`cc-seg-btn ${tf === t ? "active" : ""}`} onClick={() => setTf(t)}>
                  {tfLabel(t)}
                </button>
              ))}
            </div>
            <div style={{ color: "var(--cc-faint)" }}>
              {status === "loading" ? "loading…" : status === "error" ? "error" : symbols.length ? `${symbols.length} charts` : "—"}
              {fetchedAt ? ` · ${new Date(fetchedAt).toLocaleTimeString()}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="cc-2col" style={{ marginTop: 14, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        {Array.from({ length: 4 }).map((_, i) => {
          const sym = symbols[i] ?? "";
          const row = rows[i] ?? null;
          return (
            <div key={i} className="cc-card" style={{ minWidth: 0 }}>
              <div className="cc-card-head" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", minWidth: 0 }}>
                  <div style={{ fontWeight: 900 }}>{sym || "—"}</div>
                  <div style={{ color: "var(--cc-dim)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
                    {fmtPct(row?.todaysChangePerc)}
                  </div>
                </div>
                <div style={{ color: "var(--cc-faint)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
                  top gainer
                </div>
              </div>

              {sym ? (
                <div className="cc-tv" style={{ paddingTop: "62%" }}>
                  <iframe
                    title={`${sym} chart`}
                    src={tvSrc(sym, tf)}
                    style={{ border: 0 }}
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div style={{ padding: 14, color: "var(--cc-dim)" }}>{status === "loading" ? "Loading top gainers…" : "No symbol."}</div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

