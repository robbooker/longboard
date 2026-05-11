"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type RvolScannerHit = {
  ticker: string;
  name: string | null;
  changePct: number;
  priceNow: number;
  dayVolume: number;
  dollarVolume: number;
  signalTimeEt: string;
  signalUnixSeconds: number;
  signalPrice: number;
  signalRvol: number;
  barsScanned: number;
};

type RvolScannerPayload = {
  etDate: string;
  fetchedAt: string;
  scanned: number;
  hits: RvolScannerHit[];
  universe: {
    snapshotPool: number;
    candidateLimit: number;
    minPrice: number;
    minMovePct: number;
  };
};

type LoadState =
  | { status: "loading"; data: RvolScannerPayload | null; error: null }
  | { status: "ready"; data: RvolScannerPayload; error: null }
  | { status: "error"; data: RvolScannerPayload | null; error: string };

const REFRESH_MS = 60_000;

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 10 ? 2 : 4,
    maximumFractionDigits: value >= 10 ? 2 : 4,
  }).format(value);
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatFetchedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

async function fetchScanner(signal?: AbortSignal): Promise<RvolScannerPayload> {
  const response = await fetch("/api/command2/rvol-scanner", {
    cache: "no-store",
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load scanner.");
  }
  return json as RvolScannerPayload;
}

export default function RvolScannerClient() {
  const [state, setState] = useState<LoadState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const load = async (showLoading: boolean) => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      if (showLoading) {
        setState((existing) => ({ status: "loading", data: existing.data, error: null }));
      }
      try {
        const data = await fetchScanner(current.signal);
        if (!cancelled) setState({ status: "ready", data, error: null });
      } catch (error) {
        if (cancelled || current.signal.aborted) return;
        setState((existing) => ({
          status: "error",
          data: existing.data,
          error: error instanceof Error ? error.message : "Unable to load scanner.",
        }));
      }
    };

    void load(true);
    const id = window.setInterval(() => void load(false), REFRESH_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(id);
    };
  }, []);

  const data = state.data;
  const rows = data?.hits ?? [];
  const latestSignal = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((latest, row) =>
      row.signalUnixSeconds > latest.signalUnixSeconds ? row : latest,
    );
  }, [rows]);

  return (
    <main className="scanner">
      <style>{`
        .scanner{
          --ink:#15120B;
          --paper:#F6F2E9;
          --card:#FFFCF4;
          --line:rgba(21,18,11,0.18);
          --muted:rgba(21,18,11,0.62);
          --amber:#F5A524;
          --gold:#B8860B;
          min-height:calc(100vh - 104px);
          background:var(--paper);
          color:var(--ink);
          font-family:Helvetica,Arial,sans-serif;
          padding:34px 28px 72px;
        }
        .scanner *{box-sizing:border-box}
        .scanner .wrap{max-width:1480px;margin:0 auto}
        .scanner .mono{font-family:'Courier New',Courier,monospace;letter-spacing:1.5px;text-transform:uppercase;font-weight:700}
        .scanner .crumb{font-size:11px;color:var(--gold);margin-bottom:14px}
        .scanner .head{
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          gap:22px;
          align-items:end;
          border-bottom:2px solid var(--amber);
          padding-bottom:22px;
        }
        .scanner h1{
          margin:0;
          font-size:82px;
          line-height:.9;
          letter-spacing:0;
          font-weight:900;
        }
        .scanner .head-copy{
          margin-top:14px;
          max-width:760px;
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-style:italic;
          font-size:18px;
          line-height:1.42;
        }
        .scanner .meta{
          display:grid;
          grid-template-columns:repeat(3,minmax(120px,1fr));
          border:1px solid var(--line);
          background:var(--card);
          min-width:430px;
        }
        .scanner .meta div{padding:14px 16px;border-left:1px solid var(--line)}
        .scanner .meta div:first-child{border-left:0}
        .scanner .meta span{display:block;font-size:10px;color:var(--gold);margin-bottom:6px}
        .scanner .meta b{font-size:24px;letter-spacing:0}
        .scanner .status{
          margin-top:22px;
          display:flex;
          justify-content:space-between;
          gap:16px;
          align-items:center;
          color:var(--muted);
          font-size:11px;
        }
        .scanner .status strong{color:var(--ink)}
        .scanner .status .error{color:#C8283D}
        .scanner .panel{
          margin-top:18px;
          background:var(--card);
          border:1px solid var(--line);
          overflow:hidden;
        }
        .scanner table{
          width:100%;
          border-collapse:collapse;
          table-layout:fixed;
        }
        .scanner th{
          text-align:left;
          padding:12px 16px;
          border-bottom:1px solid var(--line);
          color:var(--gold);
          font-size:10px;
        }
        .scanner td{
          padding:17px 16px;
          border-top:1px solid rgba(21,18,11,0.11);
          vertical-align:middle;
        }
        .scanner tbody tr:first-child td{border-top:0}
        .scanner .ticker{
          display:flex;
          flex-direction:column;
          gap:5px;
          min-width:0;
        }
        .scanner .ticker a{
          width:max-content;
          color:var(--ink);
          text-decoration:none;
          font-weight:900;
          font-size:30px;
          line-height:1;
          letter-spacing:0;
          border-bottom:2px solid transparent;
        }
        .scanner .ticker a:hover,
        .scanner .ticker a:focus-visible{border-color:var(--amber);outline:none}
        .scanner .ticker span{
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-style:italic;
          font-size:13px;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .scanner .big{
          font-size:26px;
          line-height:1;
          letter-spacing:0;
          font-weight:900;
        }
        .scanner .gold{color:var(--gold)}
        .scanner .small{font-size:11px;color:var(--muted)}
        .scanner .empty{
          min-height:260px;
          display:grid;
          place-items:center;
          text-align:center;
          padding:36px;
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-style:italic;
          font-size:18px;
        }
        @media (max-width:980px){
          .scanner{padding:26px 16px 56px}
          .scanner .head{grid-template-columns:1fr}
          .scanner h1{font-size:56px}
          .scanner .meta{min-width:0}
          .scanner .panel{overflow-x:auto}
          .scanner table{min-width:860px}
        }
        @media (max-width:640px){
          .scanner h1{font-size:44px}
          .scanner .meta{grid-template-columns:1fr}
          .scanner .meta div{border-left:0;border-top:1px solid var(--line)}
          .scanner .meta div:first-child{border-top:0}
          .scanner .status{align-items:flex-start;flex-direction:column}
        }
      `}</style>

      <div className="wrap">
        <div className="crumb mono">COMMAND CENTER / RVOL SCANNER</div>
        <section className="head">
          <div>
            <h1>RVOL Signal Scanner</h1>
            <div className="head-copy">
              Top moving common stocks with a 1m RVOL entry printed today.
            </div>
          </div>
          <div className="meta">
            <div>
              <span className="mono">Signals</span>
              <b>{rows.length}</b>
            </div>
            <div>
              <span className="mono">Scanned</span>
              <b>{data?.scanned ?? "..."}</b>
            </div>
            <div>
              <span className="mono">Latest</span>
              <b>{latestSignal?.signalTimeEt ?? "--:--"}</b>
            </div>
          </div>
        </section>

        <div className="status mono">
          <span>
            {state.status === "loading"
              ? "LOADING"
              : data
                ? `${data.etDate} ET / UPDATED ${formatFetchedAt(data.fetchedAt)} ET / TOP ${data.universe.candidateLimit} AFTER FILTERS`
                : "WAITING"}
          </span>
          {state.status === "error" ? <span className="error">{state.error}</span> : <strong>60S POLYGON REFRESH</strong>}
        </div>

        <section className="panel">
          {rows.length > 0 ? (
            <table>
              <thead>
                <tr className="mono">
                  <th style={{ width: "22%" }}>Ticker</th>
                  <th>Signal ET</th>
                  <th>Signal Price</th>
                  <th>Price Now</th>
                  <th>Move</th>
                  <th>RVOL</th>
                  <th>Dollar Vol</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.ticker}-${row.signalUnixSeconds}`}>
                    <td>
                      <div className="ticker">
                        <Link href={`/command2/briefing/${encodeURIComponent(row.ticker)}`}>
                          {row.ticker}
                        </Link>
                        <span>{row.name ?? "Common stock"}</span>
                      </div>
                    </td>
                    <td>
                      <div className="big">{row.signalTimeEt}</div>
                      <div className="small mono">{row.barsScanned} bars</div>
                    </td>
                    <td className="big">{money(row.signalPrice)}</td>
                    <td className="big">{money(row.priceNow)}</td>
                    <td className="big gold">{pct(row.changePct)}</td>
                    <td>
                      <div className="big">{row.signalRvol.toFixed(1)}x</div>
                    </td>
                    <td>
                      <div className="big">{compact(row.dollarVolume)}</div>
                      <div className="small mono">{compact(row.dayVolume)} sh</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">
              {state.status === "loading"
                ? "Scanning..."
                : "No RVOL entries in the filtered mover list yet."}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
