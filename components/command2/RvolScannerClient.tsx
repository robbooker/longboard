"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Command2EmbeddedStockChart } from "@/components/command2/Command2StockChart";

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

type AskEdgarSummary = {
  ticker: string;
  fetchedAt: string;
  marketCap: number | null;
  estimatedCash: number | null;
  cashRemainingMonths: number | null;
  dilutionRisk: string | null;
  dilutionRiskDesc: string | null;
  cashNeed: string | null;
  cashNeedDesc: string | null;
  overallOfferingRisk: string | null;
  offeringAbility: string | null;
  offeringAbilityDesc: string | null;
  offeringFrequency: string | null;
  offeringFrequencyDesc: string | null;
  nasdaqCompliance: string | null;
  nasdaqComplianceDesc: string | null;
  cashBurn: number | null;
  regsho: boolean | null;
  notes: string | null;
  errors: string[];
};

type LoadState =
  | { status: "loading"; data: RvolScannerPayload | null; error: null }
  | { status: "ready"; data: RvolScannerPayload; error: null }
  | { status: "error"; data: RvolScannerPayload | null; error: string };

type DetailState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: AskEdgarSummary; error: null }
  | { status: "error"; data: null; error: string };

type DetailTone = "good" | "watch" | "risk" | "neutral";

const REFRESH_MS = 60_000;
const UNAVAILABLE = "Unavailable";

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

function compactMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNAVAILABLE;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
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
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load scanner.");
  }
  return json as RvolScannerPayload;
}

async function fetchAskEdgarSummary(ticker: string, signal?: AbortSignal): Promise<AskEdgarSummary> {
  const params = new URLSearchParams({ ticker });
  const response = await fetch(`/api/command2/askedgar-summary?${params.toString()}`, {
    signal,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Unable to load AskEdgar details.");
  }
  return json as AskEdgarSummary;
}

function rating(value: string | null): string {
  return value?.trim() ? value.trim().toUpperCase() : UNAVAILABLE;
}

function riskTone(value: string | null): DetailTone {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("high") || normalized === "yes") return "risk";
  if (normalized.includes("medium") || normalized.includes("moderate")) return "watch";
  if (normalized.includes("low") || normalized === "no") return "good";
  return "neutral";
}

function runwayTone(months: number | null): DetailTone {
  if (months === null || !Number.isFinite(months)) return "neutral";
  if (months < 6) return "risk";
  if (months < 12) return "watch";
  return "good";
}

function detailRows(data: AskEdgarSummary): Array<[string, string, DetailTone]> {
  return [
    ["Market cap", compactMoney(data.marketCap), "neutral"],
    ["Cash", compactMoney(data.estimatedCash), "neutral"],
    [
      "Runway",
      data.cashRemainingMonths === null || !Number.isFinite(data.cashRemainingMonths)
        ? UNAVAILABLE
        : `${data.cashRemainingMonths.toFixed(1)} mo`,
      runwayTone(data.cashRemainingMonths),
    ],
    ["Overall risk", rating(data.overallOfferingRisk), riskTone(data.overallOfferingRisk)],
    ["Dilution", rating(data.dilutionRisk), riskTone(data.dilutionRisk)],
    ["Cash need", rating(data.cashNeed), riskTone(data.cashNeed)],
    ["Offer ability", rating(data.offeringAbility), riskTone(data.offeringAbility)],
    ["Offer frequency", rating(data.offeringFrequency), riskTone(data.offeringFrequency)],
    ["Listing risk", rating(data.nasdaqCompliance), riskTone(data.nasdaqCompliance)],
    ["Cash burn", compactMoney(data.cashBurn), "neutral"],
    ["Reg SHO", data.regsho === null ? UNAVAILABLE : data.regsho ? "YES" : "NO", riskTone(data.regsho === null ? null : data.regsho ? "high" : "low")],
  ];
}

function hasUsableAskEdgarData(data: AskEdgarSummary): boolean {
  return detailRows(data).some(([, value]) => value !== UNAVAILABLE) || !!data.notes;
}

function detailDrivers(data: AskEdgarSummary): Array<[string, string]> {
  return [
    ["Dilution", data.dilutionRiskDesc],
    ["Cash need", data.cashNeedDesc],
    ["Offering ability", data.offeringAbilityDesc],
    ["Offering frequency", data.offeringFrequencyDesc],
    ["Listing risk", data.nasdaqComplianceDesc],
  ].filter((row): row is [string, string] => typeof row[1] === "string" && row[1].trim().length > 0);
}

export default function RvolScannerClient() {
  const [state, setState] = useState<LoadState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [detailsByTicker, setDetailsByTicker] = useState<Record<string, DetailState>>({});

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

  function loadAskEdgarDetails(ticker: string) {
    if (detailsByTicker[ticker]) return;

    setDetailsByTicker((existing) => ({
      ...existing,
      [ticker]: { status: "loading", data: null, error: null },
    }));

    fetchAskEdgarSummary(ticker)
      .then((data) => {
        setDetailsByTicker((existing) => ({
          ...existing,
          [ticker]: { status: "ready", data, error: null },
        }));
      })
      .catch((error) => {
        setDetailsByTicker((existing) => ({
          ...existing,
          [ticker]: {
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Unable to load AskEdgar details.",
          },
        }));
      });
  }

  function toggleExpanded(ticker: string) {
    const opening = expandedTicker !== ticker;
    setExpandedTicker(opening ? ticker : null);
    if (opening) loadAskEdgarDetails(ticker);
  }

  function renderAskEdgarDetails(ticker: string) {
    const detailState = detailsByTicker[ticker];

    if (detailState?.status === "ready") {
      const detail = detailState.data;
      const rows = detailRows(detail);
      const hasData = hasUsableAskEdgarData(detail);

      if (!hasData && detail.errors.length > 0) {
        return (
          <div className="detail-message" role="status">
            <strong>Details unavailable</strong>
            <span>
              The request did not return usable dilution data for this ticker.
            </span>
          </div>
        );
      }

      return (
        <>
          <div className="detail-topline">
            {rows.slice(0, 4).map(([label, value, tone]) => (
              <div className={`detail-stat detail-stat--${tone}`} key={label}>
                <span className="mono">{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>

          <div className="detail-grid">
            {rows.slice(4).map(([label, value, tone]) => (
              <div className={`detail-item detail-item--${tone}`} key={label}>
                <span className="mono">{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>

          {detailDrivers(detail).length > 0 && (
            <div className="detail-drivers">
              {detailDrivers(detail).map(([label, description]) => (
                <div className="detail-driver" key={label}>
                  <span className="mono">{label}</span>
                  <p>{description}</p>
                </div>
              ))}
            </div>
          )}

          {detail.notes && <div className="detail-notes">{detail.notes}</div>}

          {detail.errors.length > 0 && (
            <div className="detail-warning">
              Some AskEdgar fields did not return for this ticker.
            </div>
          )}
        </>
      );
    }

    if (detailState?.status === "error") {
      return (
        <div className="detail-message" role="status">
          <strong>Details unavailable</strong>
          <span>{detailState.error}</span>
        </div>
      );
    }

    return (
      <div className="detail-message" role="status">
        <strong>Loading dilution data</strong>
        <span>Market cap, cash, and dilution risk are loading.</span>
      </div>
    );
  }

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
        .scanner .scan-row{
          cursor:pointer;
        }
        .scanner .scan-row:hover td,
        .scanner .scan-row.is-open td{
          background:rgba(245,165,36,0.09);
        }
        .scanner tbody tr:first-child td{border-top:0}
        .scanner .ticker{
          display:flex;
          flex-direction:column;
          gap:5px;
          min-width:0;
        }
        .scanner .ticker button{
          width:max-content;
          max-width:100%;
          border:0;
          background:transparent;
          padding:0;
          color:var(--ink);
          cursor:pointer;
          text-align:left;
          font-weight:900;
          font-size:30px;
          line-height:1;
          letter-spacing:0;
          border-bottom:2px solid transparent;
        }
        .scanner .ticker button:hover,
        .scanner .ticker button:focus-visible{border-color:var(--amber);outline:none}
        .scanner .ticker b{
          display:inline-block;
          color:var(--gold);
          font-family:'Courier New',Courier,monospace;
          font-size:18px;
          transform:translateY(-2px);
          width:20px;
        }
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
        .scanner .detail-cell{
          padding:0;
          background:#FBF8F0;
        }
        .scanner .detail-box{
          display:grid;
          grid-template-columns:minmax(0,2fr) minmax(280px,1fr);
          gap:0;
          align-items:start;
          border-top:1px solid rgba(21,18,11,0.18);
        }
        .scanner .detail-chart{
          min-width:0;
          border-right:1px solid rgba(21,18,11,0.16);
        }
        .scanner .detail-chart .cc2-embedded-chart{
          border-top:0;
          background:transparent;
        }
        .scanner .detail-research{
          height:470px;
          max-height:470px;
          min-height:0;
          overflow:auto;
          padding:20px 20px 18px;
          display:flex;
          flex-direction:column;
          gap:14px;
        }
        .scanner .detail-topline{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:10px;
        }
        .scanner .detail-stat{
          min-height:96px;
          padding:14px;
          border:1px solid rgba(21,18,11,0.14);
          background:rgba(255,252,244,0.72);
        }
        .scanner .detail-stat span,
        .scanner .detail-item span,
        .scanner .detail-driver span{
          color:var(--gold);
          font-size:9px;
        }
        .scanner .detail-stat b{
          display:block;
          margin-top:12px;
          font-size:30px;
          line-height:0.95;
          letter-spacing:0;
        }
        .scanner .detail-stat--risk,
        .scanner .detail-item--risk{
          border-color:rgba(200,40,61,0.28);
          background:rgba(200,40,61,0.055);
        }
        .scanner .detail-stat--risk b,
        .scanner .detail-item--risk b{
          color:#A52A2A;
        }
        .scanner .detail-stat--watch,
        .scanner .detail-item--watch{
          border-color:rgba(184,134,11,0.28);
          background:rgba(245,165,36,0.075);
        }
        .scanner .detail-stat--watch b,
        .scanner .detail-item--watch b{
          color:var(--gold);
        }
        .scanner .detail-stat--good,
        .scanner .detail-item--good{
          border-color:rgba(13,79,60,0.22);
          background:rgba(13,79,60,0.055);
        }
        .scanner .detail-stat--good b,
        .scanner .detail-item--good b{
          color:#0D4F3C;
        }
        .scanner .detail-grid{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          gap:8px;
        }
        .scanner .detail-item{
          display:grid;
          grid-template-columns:1fr;
          gap:4px;
          padding:10px 12px;
          border:1px solid rgba(21,18,11,0.12);
          background:rgba(255,252,244,0.48);
        }
        .scanner .detail-item b{
          font-size:18px;
          line-height:1.12;
          letter-spacing:0;
        }
        .scanner .detail-drivers{
          display:grid;
          gap:10px;
          margin-top:2px;
          padding-top:12px;
          border-top:1px solid rgba(21,18,11,0.16);
        }
        .scanner .detail-driver{
          display:grid;
          gap:4px;
        }
        .scanner .detail-driver p{
          margin:0;
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-style:italic;
          font-size:13px;
          line-height:1.34;
        }
        .scanner .detail-notes{
          color:var(--muted);
          font-family:Georgia,'Times New Roman',serif;
          font-size:14px;
          line-height:1.45;
          font-style:italic;
        }
        .scanner .detail-message{
          flex:1;
          display:grid;
          align-content:center;
          place-items:center;
          gap:8px;
          min-height:220px;
          text-align:center;
          border:1px dashed rgba(21,18,11,0.18);
          color:var(--muted);
          padding:22px;
          font-size:13px;
        }
        .scanner .detail-message strong{
          color:var(--ink);
          font-size:18px;
          line-height:1;
          letter-spacing:0;
        }
        .scanner .detail-message span{
          max-width:320px;
          font-family:Georgia,'Times New Roman',serif;
          font-style:italic;
          line-height:1.42;
        }
        .scanner .detail-warning{
          color:#9A5C00;
          font-size:11px;
          line-height:1.35;
        }
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
          .scanner .detail-box{grid-template-columns:1fr}
          .scanner .detail-chart{border-right:0;border-bottom:1px solid rgba(21,18,11,0.16)}
          .scanner .detail-research{height:auto;max-height:none}
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
                {rows.map((row, index) => (
                  <Fragment key={`${row.ticker}-${row.signalUnixSeconds}`}>
                    <tr
                      className={`scan-row${expandedTicker === row.ticker ? " is-open" : ""}`}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a,button")) return;
                        toggleExpanded(row.ticker);
                      }}
                    >
                      <td>
                        <div className="ticker">
                          <button
                            type="button"
                            aria-expanded={expandedTicker === row.ticker}
                            aria-controls={`rvol-detail-${row.ticker}`}
                            onClick={() => toggleExpanded(row.ticker)}
                          >
                            <b aria-hidden="true">{expandedTicker === row.ticker ? "-" : "+"}</b>
                            {row.ticker}
                          </button>
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
                    {expandedTicker === row.ticker && (
                      <tr>
                        <td colSpan={7} className="detail-cell">
                          <div id={`rvol-detail-${row.ticker}`} className="detail-box">
                            <div className="detail-chart">
                              <Command2EmbeddedStockChart ticker={row.ticker} rankLabel={`RVOL ${index + 1}`} />
                            </div>
                            <aside className="detail-research" aria-label={`${row.ticker} AskEdgar details`}>
                              {renderAskEdgarDetails(row.ticker)}
                            </aside>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
