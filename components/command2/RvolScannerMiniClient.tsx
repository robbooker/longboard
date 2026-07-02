"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type SignalResolution = "1m" | "5m" | "1h" | "4h";

type RvolScannerHit = {
  ticker: string;
  name: string | null;
  resolution: SignalResolution;
  changePct: number;
  priceNow: number;
  dayVolume: number;
  dollarVolume: number;
  signalTimeEt: string;
  signalUnixSeconds: number;
  signalPrice: number;
  signalRvol: number;
};

type RvolScannerPayload = {
  etDate: string;
  fetchedAt: string;
  scanned: number;
  resolution: SignalResolution | "all";
  hits: RvolScannerHit[];
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

async function fetchFiveMinuteScanner(signal?: AbortSignal): Promise<RvolScannerPayload> {
  const params = new URLSearchParams({ mode: "intraday", resolution: "5m" });
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

export default function RvolScannerMiniClient({ popout = false }: { popout?: boolean }) {
  const [state, setState] = useState<LoadState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const load = async (showLoading: boolean) => {
      if (controller) return;
      const current = new AbortController();
      controller = current;
      if (showLoading) {
        setState((existing) => ({ status: "loading", data: existing.data, error: null }));
      }

      try {
        const data = await fetchFiveMinuteScanner(current.signal);
        if (!cancelled) setState({ status: "ready", data, error: null });
      } catch (error) {
        if (cancelled || current.signal.aborted) return;
        setState((existing) => ({
          status: "error",
          data: existing.data,
          error: error instanceof Error ? error.message : "Unable to load scanner.",
        }));
      } finally {
        if (controller === current) controller = null;
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

  const rows = useMemo(() => {
    const hits = state.data?.hits ?? [];
    return hits
      .slice()
      .sort((a, b) =>
        b.signalUnixSeconds - a.signalUnixSeconds ||
        b.signalRvol - a.signalRvol ||
        a.ticker.localeCompare(b.ticker),
      );
  }, [state.data]);

  function openPopout() {
    const url = new URL("/scanner3?popout=1", window.location.origin);
    const opened = window.open(
      url.toString(),
      "longboard-scanner-3",
      "popup=yes,width=430,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes",
    );
    opened?.focus();
  }

  return (
    <main className={`scanner3${popout ? " is-popout" : ""}`}>
      <style>{`
        .scanner3{
          --ink:#15120B;
          --paper:#F6F2E9;
          --card:#FBF8F0;
          --line:rgba(21,18,11,0.14);
          --muted:rgba(21,18,11,0.58);
          --amber:#F5A524;
          --gold:#B8860B;
          --red:#C94B43;
          --green:#00824C;
          min-height:calc(100vh - 96px);
          background:var(--paper);
          color:var(--ink);
          font-family:Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;
          padding:28px;
        }
        .scanner3.is-popout{
          min-height:100vh;
          padding:10px;
          background:#15120B;
        }
        .scanner3 *{box-sizing:border-box}
        .scanner3 a{color:inherit;text-decoration:none}
        .scanner3 .mono{
          font-family:"Courier New",Courier,monospace;
          letter-spacing:1.2px;
          text-transform:uppercase;
          font-weight:700;
        }
        .scanner3 .shell{
          width:min(430px,100%);
          margin:0 auto;
          border:1px solid rgba(21,18,11,0.2);
          background:var(--card);
          box-shadow:0 22px 55px rgba(21,18,11,0.18);
        }
        .scanner3.is-popout .shell{
          width:100%;
          min-height:calc(100vh - 20px);
          border-color:rgba(244,241,232,0.2);
          box-shadow:none;
        }
        .scanner3 .head{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding:10px 12px;
          background:var(--ink);
          color:rgba(244,241,232,0.9);
          border-bottom:3px solid var(--amber);
        }
        .scanner3 .brand-mark{
          display:grid;
          place-items:center;
          width:30px;
          height:30px;
          margin:0;
          background:var(--amber);
          color:var(--ink);
          font-size:18px;
          line-height:1;
          letter-spacing:0;
          font-weight:900;
        }
        .scanner3 .head-actions{
          display:flex;
          align-items:center;
          gap:8px;
          flex:0 0 auto;
        }
        .scanner3 .icon-button{
          display:grid;
          place-items:center;
          width:34px;
          height:34px;
          border:1px solid rgba(244,241,232,0.24);
          background:rgba(244,241,232,0.08);
          color:rgba(244,241,232,0.92);
          cursor:pointer;
          font-size:16px;
          line-height:1;
        }
        .scanner3 .icon-button:hover,
        .scanner3 .icon-button:focus-visible{
          border-color:var(--amber);
          outline:none;
          box-shadow:0 0 0 3px rgba(245,165,36,0.2);
        }
        .scanner3 .error{color:var(--red)}
        .scanner3 .rows{
          display:flex;
          flex-direction:column;
        }
        .scanner3 .row{
          display:grid;
          grid-template-columns:minmax(72px,0.75fr) minmax(0,1fr) auto;
          gap:10px;
          align-items:center;
          min-height:64px;
          padding:11px 12px;
          border-bottom:1px solid var(--line);
        }
        .scanner3 .row:hover,
        .scanner3 .row:focus-visible{
          background:rgba(245,165,36,0.09);
          outline:none;
        }
        .scanner3 .ticker{
          min-width:0;
        }
        .scanner3 .ticker b{
          display:block;
          font-size:22px;
          line-height:1;
          letter-spacing:0;
        }
        .scanner3 .ticker span,
        .scanner3 .details span{
          display:block;
          color:var(--muted);
          font-size:10px;
          line-height:1.25;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .scanner3 .details{
          min-width:0;
        }
        .scanner3 .details strong{
          display:block;
          font-size:13px;
          line-height:1.2;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;
        }
        .scanner3 .move{
          display:flex;
          flex-direction:column;
          align-items:flex-end;
          gap:4px;
          min-width:76px;
        }
        .scanner3 .move strong{
          color:var(--green);
          font-size:15px;
        }
        .scanner3 .move span{
          color:var(--gold);
          font-size:11px;
        }
        .scanner3 .empty{
          display:grid;
          min-height:280px;
          place-items:center;
          padding:22px;
          text-align:center;
          color:var(--muted);
          font-size:12px;
        }
        @media (max-width:560px){
          .scanner3{padding:12px}
          .scanner3 .shell{width:100%}
          .scanner3 .row{
            grid-template-columns:minmax(58px,0.65fr) minmax(0,1fr) auto;
            gap:8px;
          }
          .scanner3 .ticker b{font-size:19px}
          .scanner3 .move{min-width:62px}
        }
      `}</style>

      <section className="shell" aria-labelledby="scanner3-title">
        <header className="head">
          <h1 id="scanner3-title" className="brand-mark" aria-label="Longboard Scanner 3">
            L
          </h1>
          <div className="head-actions">
            {!popout && (
              <button
                type="button"
                className="icon-button"
                onClick={openPopout}
                aria-label="Open Scanner 3 pop-out"
                title="Open pop-out"
              >
                ↗
              </button>
            )}
            {popout && (
              <Link className="icon-button" href="/scanner3" aria-label="Open full Scanner 3" title="Open full view">
                □
              </Link>
            )}
          </div>
        </header>

        <div className="rows">
          {rows.length > 0 ? (
            rows.map((row) => (
              <Link
                key={`${row.resolution}:${row.ticker}:${row.signalUnixSeconds}`}
                className="row"
                href={`/command2/briefing/${encodeURIComponent(row.ticker)}`}
              >
                <div className="ticker">
                  <b>{row.ticker}</b>
                  <span className="mono">{row.signalTimeEt} ET</span>
                </div>
                <div className="details">
                  <strong>{money(row.priceNow)} now / {money(row.signalPrice)} signal</strong>
                  <span>{compact(row.dayVolume)} sh / {row.name ?? "Common stock"}</span>
                </div>
                <div className="move mono">
                  <strong>{pct(row.changePct)}</strong>
                  <span>{row.signalRvol.toFixed(1)}x</span>
                </div>
              </Link>
            ))
          ) : (
            <div className="empty">
              {state.status === "loading"
                ? "Scanning the 5m tape..."
                : state.status === "error"
                  ? state.error
                  : "No 5m momentum entries in the filtered mover list yet."}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
