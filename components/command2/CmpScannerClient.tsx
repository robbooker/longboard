"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Command2EmbeddedStockChart } from "@/components/command2/Command2StockChart";
import type { ChartPriceLevel } from "@/app/lab/chart/ChartView";
import type { CmpScanResult } from "@/lib/scanners/cmpScanner";
import { CMP_SCANNER_STAGE_LABELS, type CmpScannerRow } from "@/lib/scanners/cmpScannerRows";

type LoadState =
  | { status: "loading"; data: CmpScanResult | null; error: null }
  | { status: "ready"; data: CmpScanResult; error: null }
  | { status: "error"; data: CmpScanResult | null; error: string };

/** The server refreshes the shared scan every ~2 minutes; never poll faster. */
const POLL_MS = 120_000;

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function etTime(unixSeconds: number | null): string {
  return unixSeconds === null ? "--" : TIME_FMT.format(new Date(unixSeconds * 1000));
}

function stageText(row: CmpScannerRow): string {
  const label = CMP_SCANNER_STAGE_LABELS[row.stage];
  return row.stage === "pullback" && row.grade ? `${label} ${row.grade}` : label;
}

function chartLevels(row: CmpScannerRow): ChartPriceLevel[] {
  const levels: ChartPriceLevel[] = [];
  const add = (price: number | null, label: string, color: string, dashed = false) => {
    if (price !== null && Number.isFinite(price)) levels.push({ price, label, color, dashed });
  };
  add(row.entry, row.stage === "dip" ? "TRIGGER" : "ENTRY", "#255f85");
  add(row.stop, "STOP", "#bf3b35");
  add(row.t1, "T1", "#15825e");
  add(row.cmp, "CMP", "#B8860B", true);
  add(row.ghost, "GHOST", "#7a3fa3", true);
  return levels;
}

async function fetchScan(signal: AbortSignal): Promise<CmpScanResult> {
  const response = await fetch("/api/command2/cmp-scanner", { cache: "no-store", signal });
  const json = await response.json();
  if (!response.ok) throw new Error(typeof json?.error === "string" ? json.error : "Unable to load the scanner.");
  return json as CmpScanResult;
}

export default function CmpScannerClient() {
  const [state, setState] = useState<LoadState>({ status: "loading", data: null, error: null });
  const [openTicker, setOpenTicker] = useState<string | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;
    let timer: number | null = null;
    let lastLoad = 0;

    const load = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      lastLoad = Date.now();
      try {
        const data = await fetchScan(current.signal);
        setState({ status: "ready", data, error: null });
      } catch (error) {
        if (current.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Unable to load the scanner.";
        setState((prev) => ({ status: "error", data: prev.data, error: message }));
      }
    };

    // Poll only while the tab is visible, at most once per POLL_MS.
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (document.visibilityState !== "visible") return;
      const wait = Math.max(0, lastLoad + POLL_MS - Date.now());
      timer = window.setTimeout(() => {
        void load().finally(schedule);
      }, wait);
    };

    const onVisibility = () => schedule();
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") void load().finally(schedule);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  const data = state.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const active = rows.filter((row) => row.stage !== "waiting").length;

  return (
    <main className="cmp-scanner">
      <style>{styles}</style>
      <div className="wrap">
        <div className="crumb mono">SCANNER / LB SCANNER</div>
        <section className="hero" aria-labelledby="cmp-scanner-title">
          <div>
            <h1 id="cmp-scanner-title">LB Scanner</h1>
            <p className="hero-copy">
              Today&apos;s top gainers run through the CMP system (Setup 1: 9 EMA dip and bounce under the Current
              Monthly Pivot) on 2-minute extended-hours bars. Click a ticker for its chart and levels.
            </p>
          </div>
          <a className="live-link mono" href="/scanner">RVOL Scanner</a>
        </section>

        <p className="disclaimer">
          Education, not advice. These are rule-based levels from the CMP system for study; they are not trade
          recommendations.
        </p>

        <div className="status-line mono">
          <span>
            {data
              ? `UPDATED ${etTime(Math.floor(Date.parse(data.fetchedAt) / 1000))} ET / ${data.barMinutes}M BARS / ${rows.length} GAINERS / ${active} IN PLAY`
              : state.status === "loading"
                ? "LOADING SCAN"
                : "WAITING"}
          </span>
          {state.status === "error" && <span className="error">{state.error}</span>}
        </div>

        {rows.length > 0 ? (
          <table>
            <thead>
              <tr className="mono">
                <th style={{ width: "14%" }}>Ticker</th>
                <th>Stage</th>
                <th>Entry</th>
                <th>Stop</th>
                <th>T1</th>
                <th>CMP</th>
                <th>Ghost</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOpen = openTicker === row.ticker;
                return (
                  <Fragment key={row.ticker}>
                    <tr
                      className={`signal-row stage-${row.stage}${isOpen ? " is-open" : ""}`}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a,button")) return;
                        setOpenTicker(isOpen ? null : row.ticker);
                      }}
                    >
                      <td>
                        <div className="ticker">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={`cmp-detail-${row.ticker}`}
                            onClick={() => setOpenTicker(isOpen ? null : row.ticker)}
                          >
                            <b aria-hidden="true">{isOpen ? "-" : "+"}</b>
                            {row.ticker}
                          </button>
                        </div>
                        <div className="muted mono">{pct(row.changePct)}</div>
                      </td>
                      <td>
                        <span className="badge mono">{stageText(row)}</span>
                        <div className="muted">
                          {row.stageTime !== null ? `${etTime(row.stageTime)} ET · ` : ""}
                          {row.detail}
                        </div>
                      </td>
                      <td className="big" data-label={row.stage === "dip" ? "Trigger" : "Entry"}>{money(row.entry)}</td>
                      <td className="big" data-label="Stop">{money(row.stop)}</td>
                      <td className="big" data-label="T1">{money(row.t1)}</td>
                      <td data-label="CMP">
                        <div className="big">{money(row.cmp)}</div>
                        <div className="muted mono">{pct(row.cmpDistPct)}</div>
                      </td>
                      <td data-label="Ghost">
                        <div className="big">{money(row.ghost)}</div>
                        <div className="muted mono">{pct(row.ghostDistPct)}</div>
                      </td>
                      <td data-label="Last">
                        <div className="big">{money(row.price)}</div>
                        <div className="muted mono">{etTime(row.barTime)} ET</div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={8} className="detail-cell" id={`cmp-detail-${row.ticker}`}>
                          <Command2EmbeddedStockChart
                            ticker={row.ticker}
                            rankLabel={`LB ${stageText(row)}`}
                            etDate={data?.etDate}
                            initialResolution="1m"
                            autoRefresh={false}
                            indicatorSet="core"
                            priceLevels={chartLevels(row)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : (
          state.status !== "loading" && <div className="empty">No gainers in the scan right now.</div>
        )}

        {data && data.errors.length > 0 && (
          <p className="muted mono footnote">Skipped: {data.errors.map((e) => e.ticker).join(", ")}</p>
        )}
      </div>
    </main>
  );
}

const styles = `
  .cmp-scanner{
    --cs-ink:#15120B;
    --cs-muted:rgba(21,18,11,0.62);
    --cs-ink-30:rgba(21,18,11,0.3);
    --cs-ink-15:rgba(21,18,11,0.15);
    --cs-paper:#F6F2E9;
    --cs-card:#FFFDF7;
    --cs-gold:#B8860B;
    --cs-green:#15825e;
    --cs-red:#bf3b35;
    min-height:100vh;
    background:var(--cs-paper);
    color:var(--cs-ink);
    font-family:Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .cmp-scanner *{box-sizing:border-box}
  .cmp-scanner a{color:inherit;text-decoration:none}
  .cmp-scanner .mono{
    font-family:'Courier New',Courier,monospace;
    letter-spacing:1.2px;
    text-transform:uppercase;
    font-weight:700;
  }
  .cmp-scanner .wrap{width:min(1400px,calc(100vw - 56px));margin:0 auto;padding:46px 0 72px}
  .cmp-scanner .crumb{color:var(--cs-gold);font-size:11px;margin-bottom:16px}
  .cmp-scanner .hero{
    display:grid;
    grid-template-columns:minmax(0,1fr) auto;
    gap:28px;
    align-items:end;
    padding-bottom:28px;
    border-bottom:2px solid var(--cs-ink);
  }
  .cmp-scanner h1{margin:0;font-size:clamp(34px,6vw,72px);line-height:.92;text-transform:uppercase}
  .cmp-scanner .hero-copy{max-width:700px;margin-top:14px;color:var(--cs-muted);font-size:16px;line-height:1.45}
  .cmp-scanner .live-link{
    display:inline-flex;
    align-items:center;
    min-height:40px;
    border:1px solid var(--cs-ink);
    background:var(--cs-ink);
    color:var(--cs-card);
    padding:0 15px;
    font-size:11px;
  }
  .cmp-scanner .disclaimer{margin:14px 0 0;color:var(--cs-muted);font-size:13px}
  .cmp-scanner .status-line{
    display:flex;
    justify-content:space-between;
    gap:18px;
    align-items:center;
    min-height:44px;
    color:var(--cs-muted);
    font-size:11px;
    border-bottom:1px solid var(--cs-ink-30);
  }
  .cmp-scanner .status-line .error{color:#C8283D}
  .cmp-scanner table{width:100%;border-collapse:collapse;table-layout:fixed;background:var(--cs-card)}
  .cmp-scanner th{
    height:42px;
    border-bottom:1px solid var(--cs-ink);
    color:var(--cs-gold);
    font-size:10px;
    text-align:left;
    padding:0 14px;
  }
  .cmp-scanner td{border-bottom:1px solid var(--cs-ink-15);padding:14px;vertical-align:middle}
  .cmp-scanner tbody tr.signal-row{cursor:pointer}
  .cmp-scanner tbody tr.signal-row:hover,
  .cmp-scanner tbody tr.signal-row.is-open{background:rgba(245,165,36,0.08)}
  .cmp-scanner tr.stage-waiting{opacity:.62}
  .cmp-scanner .ticker button{
    border:0;
    background:transparent;
    color:var(--cs-ink);
    padding:0;
    cursor:pointer;
    font:900 22px Helvetica,Arial,sans-serif;
  }
  .cmp-scanner .ticker b{
    display:inline-grid;
    place-items:center;
    width:20px;
    height:20px;
    margin-right:10px;
    border:1px solid var(--cs-gold);
    color:var(--cs-gold);
    font:700 14px 'Courier New',Courier,monospace;
  }
  .cmp-scanner .badge{
    display:inline-grid;
    place-items:center;
    min-width:48px;
    height:30px;
    padding:0 10px;
    margin-bottom:6px;
    border:1px solid rgba(184,134,11,0.3);
    background:rgba(245,165,36,0.08);
    color:var(--cs-gold);
    font-size:12px;
  }
  .cmp-scanner tr.stage-buy .badge,
  .cmp-scanner tr.stage-t1Hit .badge{border-color:var(--cs-green);color:var(--cs-green);background:rgba(21,130,94,0.08)}
  .cmp-scanner tr.stage-stopped .badge{border-color:var(--cs-red);color:var(--cs-red);background:rgba(191,59,53,0.08)}
  .cmp-scanner .big{font-size:17px;font-weight:900}
  .cmp-scanner .muted{color:var(--cs-muted);font-size:11px}
  .cmp-scanner .detail-cell{padding:0;background:#F8F4EA;border-bottom:1px solid var(--cs-ink)}
  .cmp-scanner .empty{
    padding:52px 18px;
    text-align:center;
    color:var(--cs-muted);
    background:var(--cs-card);
    border-bottom:1px solid var(--cs-ink-30);
  }
  .cmp-scanner .footnote{margin-top:14px}
  @media (max-width:900px){
    .cmp-scanner .wrap{width:min(100vw - 32px,720px);padding-top:30px}
    .cmp-scanner .hero{grid-template-columns:1fr;align-items:start}
    .cmp-scanner table,.cmp-scanner thead,.cmp-scanner tbody,.cmp-scanner tr,.cmp-scanner th,.cmp-scanner td{display:block}
    .cmp-scanner thead{display:none}
    .cmp-scanner tbody tr.signal-row{
      display:grid;
      grid-template-columns:1fr 1fr 1fr;
      gap:10px 16px;
      padding:16px;
      border-bottom:1px solid var(--cs-ink-15);
    }
    .cmp-scanner tbody tr.signal-row td{border:0;padding:0}
    .cmp-scanner tbody tr.signal-row td:nth-child(-n+2){grid-column:span 3}
    .cmp-scanner td[data-label]::before{
      content:attr(data-label);
      display:block;
      margin-bottom:4px;
      color:var(--cs-gold);
      font:700 10px 'Courier New',Courier,monospace;
      letter-spacing:1.2px;
      text-transform:uppercase;
    }
  }
`;
