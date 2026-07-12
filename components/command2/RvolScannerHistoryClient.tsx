"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Command2EmbeddedStockChart } from "@/components/command2/Command2StockChart";

type SignalResolution = "1m" | "5m";
type SignalResolutionFilter = SignalResolution | "all";
type SignalStatus = "pending" | "sent" | "skipped" | "failed";
type SignalStatusFilter = SignalStatus | "all";

type RvolHistorySignal = {
  alert_key: string;
  et_date: string;
  ticker: string;
  signal_resolution: SignalResolution;
  signal_unix_seconds: number;
  signal_time_et: string;
  signal_at: string;
  signal_rvol: number | null;
  signal_price: number | null;
  change_pct: number | null;
  signal_breakout_mode: "premarketHigh" | "openingRangeHigh";
  breakout_level: number | null;
  rvol_method: "sameDayRolling" | "historicalTimeOfDay";
  status: SignalStatus;
  created_at: string;
};

type RvolHistoryPayload = {
  generated_at: string;
  source: string;
  et_date: string | null;
  available_dates: string[];
  filters: {
    status: SignalStatusFilter;
    resolution: SignalResolutionFilter;
  };
  count: number;
  signals: RvolHistorySignal[];
};

type LoadState =
  | { status: "loading"; data: RvolHistoryPayload | null; error: null }
  | { status: "ready"; data: RvolHistoryPayload; error: null }
  | { status: "error"; data: RvolHistoryPayload | null; error: string };

const STATUS_FILTERS: Array<{ value: SignalStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

const RESOLUTION_FILTERS: Array<{ value: SignalResolutionFilter; label: string }> = [
  { value: "all", label: "Both" },
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
];

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return value >= 10 ? `$${value.toFixed(2)}` : `$${value.toFixed(3)}`;
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function rvol(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}x`;
}

function setupLabel(row: RvolHistorySignal) {
  return row.signal_breakout_mode === "openingRangeHigh" ? "OPENING RANGE" : "PMH";
}

function formatGeneratedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function signalKey(row: RvolHistorySignal): string {
  return `${row.signal_resolution}:${row.alert_key}`;
}

function validStatus(value: string | null): SignalStatusFilter {
  if (value === "sent" || value === "skipped" || value === "failed" || value === "pending") {
    return value;
  }
  return "all";
}

function validResolution(value: string | null): SignalResolutionFilter {
  if (value === "1m" || value === "5m") return value;
  return "all";
}

async function fetchHistory(
  date: string,
  status: SignalStatusFilter,
  resolution: SignalResolutionFilter,
  signal: AbortSignal,
) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (status !== "all") params.set("status", status);
  if (resolution !== "all") params.set("resolution", resolution);

  const response = await fetch(`/api/command2/rvol-history?${params.toString()}`, {
    cache: "no-store",
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load RVOL history.");
  }
  return json as RvolHistoryPayload;
}

export default function RvolScannerHistoryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(searchParams.get("date") ?? "");
  const [statusFilter, setStatusFilter] = useState<SignalStatusFilter>(
    validStatus(searchParams.get("status")),
  );
  const [resolutionFilter, setResolutionFilter] = useState<SignalResolutionFilter>(
    validResolution(searchParams.get("resolution") ?? searchParams.get("res")),
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState((current) => ({ status: "loading", data: current.data, error: null }));

    fetchHistory(selectedDate, statusFilter, resolutionFilter, controller.signal)
      .then((data) => {
        if (cancelled) return;
        setState({ status: "ready", data, error: null });
        if (!selectedDate && data.et_date) setSelectedDate(data.et_date);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        setState((current) => ({
          status: "error",
          data: current.data,
          error: error instanceof Error ? error.message : "Unable to load RVOL history.",
        }));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [resolutionFilter, selectedDate, statusFilter]);

  const data = state.data;
  const rows = data?.signals ?? [];
  const availableDates = data?.available_dates ?? [];
  const summary = useMemo(() => {
    const first = rows[0]?.signal_time_et ?? "--";
    const last = rows[rows.length - 1]?.signal_time_et ?? "--";
    const tickers = new Set(rows.map((row) => row.ticker)).size;
    return { first, last, tickers };
  }, [rows]);

  function updateUrl(next: {
    date?: string;
    status?: SignalStatusFilter;
    resolution?: SignalResolutionFilter;
  }) {
    const date = next.date ?? selectedDate;
    const status = next.status ?? statusFilter;
    const resolution = next.resolution ?? resolutionFilter;
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (status !== "all") params.set("status", status);
    if (resolution !== "all") params.set("resolution", resolution);
    const query = params.toString();
    router.replace(query ? `/scanner/history?${query}` : "/scanner/history", { scroll: false });
  }

  function applyDate(nextDate: string) {
    setSelectedDate(nextDate);
    setExpandedKey(null);
    updateUrl({ date: nextDate });
  }

  return (
    <main className="rvol-history">
      <style>{`
        .rvol-history{
          --ink:#15120B;
          --muted:rgba(21,18,11,0.62);
          --ink-30:rgba(21,18,11,0.3);
          --ink-15:rgba(21,18,11,0.15);
          --paper:#F6F2E9;
          --card:#FFFDF7;
          --gold:#B8860B;
          --amber:#F5A524;
          min-height:100vh;
          background:var(--paper);
          color:var(--ink);
          font-family:Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        .rvol-history *{box-sizing:border-box}
        .rvol-history a{color:inherit;text-decoration:none}
        .rvol-history .mono{
          font-family:'Courier New',Courier,monospace;
          letter-spacing:1.2px;
          text-transform:uppercase;
          font-weight:700;
        }
        .rvol-history .wrap{
          width:min(1400px,calc(100vw - 56px));
          margin:0 auto;
          padding:46px 0 72px;
        }
        .rvol-history .crumb{
          color:var(--gold);
          font-size:11px;
          margin-bottom:16px;
        }
        .rvol-history .hero{
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          gap:28px;
          align-items:end;
          padding-bottom:28px;
          border-bottom:2px solid var(--ink);
        }
        .rvol-history h1{
          margin:0;
          font-size:clamp(34px,6vw,72px);
          line-height:.92;
          letter-spacing:0;
          text-transform:uppercase;
        }
        .rvol-history .hero-copy{
          max-width:700px;
          margin-top:14px;
          color:var(--muted);
          font-size:16px;
          line-height:1.45;
        }
        .rvol-history .live-link{
          display:inline-flex;
          align-items:center;
          min-height:40px;
          border:1px solid var(--ink);
          background:var(--ink);
          color:var(--card);
          padding:0 15px;
          font-size:11px;
        }
        .rvol-history .controls{
          display:grid;
          grid-template-columns:minmax(220px,320px) 1fr 1fr;
          gap:16px;
          padding:18px 0;
          border-bottom:1px solid var(--ink-30);
        }
        .rvol-history .control{
          min-width:0;
        }
        .rvol-history label{
          display:block;
          margin-bottom:7px;
          color:var(--gold);
          font-size:10px;
        }
        .rvol-history input[type="date"]{
          width:100%;
          height:40px;
          border:1px solid var(--ink-30);
          background:var(--card);
          color:var(--ink);
          padding:0 12px;
          font:700 13px 'Courier New',Courier,monospace;
          letter-spacing:1px;
        }
        .rvol-history .segmented{
          display:inline-flex;
          width:100%;
          height:40px;
          border:1px solid var(--ink-30);
          background:var(--card);
        }
        .rvol-history .segmented button{
          flex:1;
          border:0;
          border-left:1px solid var(--ink-15);
          background:transparent;
          color:var(--muted);
          cursor:pointer;
          font:700 11px 'Courier New',Courier,monospace;
          letter-spacing:1px;
          text-transform:uppercase;
        }
        .rvol-history .segmented button:first-child{border-left:0}
        .rvol-history .segmented button:hover,
        .rvol-history .segmented button:focus-visible{
          color:var(--ink);
          outline:none;
        }
        .rvol-history .segmented button.is-active{
          background:var(--ink);
          color:var(--card);
        }
        .rvol-history .summary{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          border-bottom:1px solid var(--ink-30);
        }
        .rvol-history .metric{
          min-height:88px;
          padding:18px 16px;
          border-left:1px solid var(--ink-15);
        }
        .rvol-history .metric:first-child{border-left:0}
        .rvol-history .metric span{
          display:block;
          color:var(--muted);
          font-size:10px;
          margin-bottom:8px;
        }
        .rvol-history .metric strong{
          display:block;
          font-size:24px;
          letter-spacing:0;
        }
        .rvol-history .status-line{
          display:flex;
          justify-content:space-between;
          gap:18px;
          align-items:center;
          min-height:44px;
          color:var(--muted);
          font-size:11px;
          border-bottom:1px solid var(--ink-30);
        }
        .rvol-history .status-line .error{color:#C8283D}
        .rvol-history table{
          width:100%;
          border-collapse:collapse;
          table-layout:fixed;
          background:var(--card);
        }
        .rvol-history th{
          height:42px;
          border-bottom:1px solid var(--ink);
          color:var(--gold);
          font-size:10px;
          text-align:left;
          padding:0 14px;
        }
        .rvol-history td{
          border-bottom:1px solid var(--ink-15);
          padding:14px;
          vertical-align:middle;
        }
        .rvol-history tbody tr.signal-row{
          cursor:pointer;
        }
        .rvol-history tbody tr.signal-row:hover,
        .rvol-history tbody tr.signal-row.is-open{
          background:rgba(245,165,36,0.08);
        }
        .rvol-history .ticker button{
          border:0;
          background:transparent;
          color:var(--ink);
          padding:0;
          cursor:pointer;
          font:900 22px Helvetica,Arial,sans-serif;
          letter-spacing:0;
        }
        .rvol-history .ticker b{
          display:inline-grid;
          place-items:center;
          width:20px;
          height:20px;
          margin-right:10px;
          border:1px solid var(--gold);
          color:var(--gold);
          font:700 14px 'Courier New',Courier,monospace;
        }
        .rvol-history .badge{
          display:inline-grid;
          place-items:center;
          min-width:48px;
          height:30px;
          border:1px solid rgba(184,134,11,0.3);
          background:rgba(245,165,36,0.08);
          color:var(--gold);
          font-size:12px;
        }
        .rvol-history .big{
          font-size:17px;
          font-weight:900;
          letter-spacing:0;
        }
        .rvol-history .muted{
          color:var(--muted);
          font-size:11px;
        }
        .rvol-history .gold{color:var(--gold)}
        .rvol-history .detail-cell{
          padding:0;
          background:#F8F4EA;
        }
        .rvol-history .detail-box{
          display:grid;
          grid-template-columns:minmax(0,1fr) minmax(220px,300px);
          gap:0;
          border-bottom:1px solid var(--ink);
        }
        .rvol-history .detail-recap{
          border-left:1px solid var(--ink-30);
          padding:18px;
          background:rgba(255,253,247,0.76);
        }
        .rvol-history .detail-recap h2{
          margin:0 0 14px;
          font-size:15px;
          text-transform:uppercase;
          letter-spacing:0;
        }
        .rvol-history .recap-grid{
          display:grid;
          gap:10px;
        }
        .rvol-history .recap-row{
          display:flex;
          justify-content:space-between;
          gap:14px;
          border-bottom:1px dashed var(--ink-15);
          padding-bottom:8px;
          font-size:12px;
        }
        .rvol-history .recap-row span:first-child{color:var(--muted)}
        .rvol-history .empty{
          padding:52px 18px;
          text-align:center;
          color:var(--muted);
          background:var(--card);
          border-bottom:1px solid var(--ink-30);
        }
        @media (max-width:900px){
          .rvol-history .wrap{width:min(100vw - 32px,720px);padding-top:30px}
          .rvol-history .hero{grid-template-columns:1fr;align-items:start}
          .rvol-history .controls{grid-template-columns:1fr}
          .rvol-history .summary{grid-template-columns:repeat(2,minmax(0,1fr))}
          .rvol-history .metric:nth-child(odd){border-left:0}
          .rvol-history table,.rvol-history thead,.rvol-history tbody,.rvol-history tr,.rvol-history th,.rvol-history td{display:block}
          .rvol-history thead{display:none}
          .rvol-history tbody tr.signal-row{
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:10px 16px;
            padding:16px;
            border-bottom:1px solid var(--ink-15);
          }
          .rvol-history tbody tr.signal-row td{
            border:0;
            padding:0;
          }
          .rvol-history tbody tr.signal-row td:first-child,
          .rvol-history tbody tr.signal-row td:last-child{
            grid-column:1 / -1;
          }
          .rvol-history .detail-box{grid-template-columns:1fr}
          .rvol-history .detail-recap{border-left:0;border-top:1px solid var(--ink-30)}
        }
      `}</style>

      <div className="wrap">
        <div className="crumb mono">COMMAND CENTER / RVOL SCANNER / HISTORY</div>
        <section className="hero" aria-labelledby="rvol-history-title">
          <div>
            <h1 id="rvol-history-title">RVOL Scanner History</h1>
            <p className="hero-copy">
              Select a trading date to review the symbols that printed RVOL signals and open the intraday chart for the signal session.
            </p>
          </div>
          <a className="live-link mono" href="/scanner">Live Scanner</a>
        </section>

        <section className="controls" aria-label="History filters">
          <div className="control">
            <label className="mono" htmlFor="rvol-history-date">Signal Date</label>
            <input
              id="rvol-history-date"
              type="date"
              list="rvol-history-dates"
              value={selectedDate}
              onInput={(event) => applyDate(event.currentTarget.value)}
              onChange={(event) => applyDate(event.currentTarget.value)}
            />
            <datalist id="rvol-history-dates">
              {availableDates.map((date) => (
                <option value={date} key={date} />
              ))}
            </datalist>
          </div>

          <div className="control">
            <label className="mono">Status</label>
            <div className="segmented" aria-label="Signal status">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  className={statusFilter === filter.value ? "is-active" : ""}
                  aria-pressed={statusFilter === filter.value}
                  onClick={() => {
                    setStatusFilter(filter.value);
                    setExpandedKey(null);
                    updateUrl({ status: filter.value });
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="control">
            <label className="mono">Resolution</label>
            <div className="segmented" aria-label="Signal resolution">
              {RESOLUTION_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  className={resolutionFilter === filter.value ? "is-active" : ""}
                  aria-pressed={resolutionFilter === filter.value}
                  onClick={() => {
                    setResolutionFilter(filter.value);
                    setExpandedKey(null);
                    updateUrl({ resolution: filter.value });
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="summary" aria-label="History summary">
          <div className="metric">
            <span className="mono">Date</span>
            <strong>{data?.et_date ?? (selectedDate || "--")}</strong>
          </div>
          <div className="metric">
            <span className="mono">Signals</span>
            <strong>{rows.length}</strong>
          </div>
          <div className="metric">
            <span className="mono">Tickers</span>
            <strong>{summary.tickers}</strong>
          </div>
          <div className="metric">
            <span className="mono">Window</span>
            <strong>{summary.first} - {summary.last}</strong>
          </div>
        </section>

        <div className="status-line mono">
          <span>
            {state.status === "loading"
              ? "LOADING HISTORY"
              : data
                ? `UPDATED ${formatGeneratedAt(data.generated_at)} ET / SOURCE ${data.source}`
                : "WAITING"}
          </span>
          {state.status === "error" && <span className="error">{state.error}</span>}
        </div>

        {rows.length > 0 ? (
          <table>
            <thead>
              <tr className="mono">
                <th style={{ width: "20%" }}>Ticker</th>
                <th>Signal</th>
                <th>Time ET</th>
                <th>Price</th>
                <th>RVOL</th>
                <th>Change</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const key = signalKey(row);
                const isOpen = expandedKey === key;
                return (
                  <Fragment key={key}>
                    <tr
                      className={`signal-row${isOpen ? " is-open" : ""}`}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a,button")) return;
                        setExpandedKey(isOpen ? null : key);
                      }}
                    >
                      <td>
                        <div className="ticker">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={`rvol-history-detail-${index}`}
                            onClick={() => setExpandedKey(isOpen ? null : key)}
                          >
                            <b aria-hidden="true">{isOpen ? "-" : "+"}</b>
                            {row.ticker}
                          </button>
                        </div>
                      </td>
                      <td><span className="badge mono">{row.signal_resolution} · {setupLabel(row)}</span></td>
                      <td>
                        <div className="big">{row.signal_time_et}</div>
                        <div className="muted mono">{row.et_date}</div>
                      </td>
                      <td className="big">{money(row.signal_price)}</td>
                      <td className="big gold">{rvol(row.signal_rvol)}</td>
                      <td className="big">{pct(row.change_pct)}</td>
                      <td><span className="badge mono">{row.status}</span></td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} className="detail-cell">
                          <div id={`rvol-history-detail-${index}`} className="detail-box">
                            <Command2EmbeddedStockChart
                              ticker={row.ticker}
                              rankLabel={`RVOL ${row.signal_resolution} ${index + 1}`}
                              etDate={row.et_date}
                              initialResolution={row.signal_resolution}
                              autoRefresh={false}
                            />
                            <aside className="detail-recap" aria-label={`${row.ticker} signal recap`}>
                              <h2>{row.ticker} Signal Recap</h2>
                              <div className="recap-grid">
                                <div className="recap-row">
                                  <span className="mono">Date</span>
                                  <strong>{row.et_date}</strong>
                                </div>
                                <div className="recap-row">
                                  <span className="mono">Signal Time</span>
                                  <strong>{row.signal_time_et} ET</strong>
                                </div>
                                <div className="recap-row">
                                  <span className="mono">Resolution</span>
                                  <strong>{row.signal_resolution}</strong>
                                </div>
                                <div className="recap-row">
                                  <span className="mono">Setup</span>
                                  <strong>{setupLabel(row)}</strong>
                                </div>
                                <div className="recap-row">
                                  <span className="mono">RVOL Baseline</span>
                                  <strong>{row.rvol_method === "historicalTimeOfDay" ? "Historical time-of-day" : "Same-day rolling"}</strong>
                                </div>
                                <div className="recap-row">
                                  <span className="mono">Signal Price</span>
                                  <strong>{money(row.signal_price)}</strong>
                                </div>
                                <div className="recap-row">
                                  <span className="mono">RVOL</span>
                                  <strong>{rvol(row.signal_rvol)}</strong>
                                </div>
                                <div className="recap-row">
                                  <span className="mono">Change</span>
                                  <strong>{pct(row.change_pct)}</strong>
                                </div>
                              </div>
                            </aside>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            {state.status === "loading"
              ? "Loading signals..."
              : "No RVOL signals found for that date and filter set."}
          </div>
        )}
      </div>
    </main>
  );
}
