"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Command2EmbeddedStockChart } from "@/components/command2/Command2StockChart";
import type { LongingCohortSummary, LongingReport, LongingSignal } from "@/lib/longing/types";
import styles from "./report.module.css";

type Tab = "ledger" | "charts" | "method";
type Cohort = "actionable" | "all";
type SignalWindow = "before11" | "all";
type SortKey = "volumeAtSignal" | "dayVolume" | "signalUnixSeconds" | "dayMove8pmPct" | "return4pmPct" | "return8pmPct" | "maxFavorablePct";
type SortDirection = "asc" | "desc";

const ET_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });

function fmtPct(value: number | null, digits = 1) {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function fmtMoney(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, signDisplay: "always" }).format(value);
}

function fmtPrice(value: number | null) {
  if (value == null) return "—";
  return value < 10 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}

function fmtVolume(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString("en-US");
}

function fmtDate(iso: string) {
  return ET_DATE.format(new Date(`${iso}T16:00:00Z`));
}

function tone(value: number | null) {
  if (value == null || value === 0) return styles.flat;
  return value > 0 ? styles.positive : styles.negative;
}

function isBefore11am(row: LongingSignal) {
  return row.signalTimeEt < "11:00";
}

function signalSession(row: LongingSignal) {
  if (row.signalTimeEt < "09:30") return "premarket";
  if (row.signalTimeEt < "16:00") return "regular session";
  return "after-hours";
}

function setupLabel(row: LongingSignal) {
  return row.breakoutMode === "openingRangeHigh" ? "opening range" : "PMH";
}

function mondayInput(date = new Date()) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + offset);
  return monday.toISOString().slice(0, 10);
}

function metric(label: string, value: string, note: string, className = "") {
  return <div className={styles.metric}><span>{label}</span><strong className={className}>{value}</strong><small>{note}</small></div>;
}

function summaryCards(summary: LongingCohortSummary) {
  return (
    <div className={styles.metrics}>
      {metric("Signals", String(summary.signals), `${fmtMoney(summary.capitalDeployed)} deployed`)}
      {metric("Average to 4pm", fmtPct(summary.average4pmPct), `median ${fmtPct(summary.median4pmPct)} · win ${fmtPct(summary.winRate4pmPct)}`, tone(summary.average4pmPct))}
      {metric("Average to 8pm", fmtPct(summary.average8pmPct), `median ${fmtPct(summary.median8pmPct)} · win ${fmtPct(summary.winRate8pmPct)}`, tone(summary.average8pmPct))}
      {metric("20% target hit", fmtPct(summary.target20HitRatePct), `avg max move ${fmtPct(summary.averageMaxFavorablePct)}`, tone(summary.target20HitRatePct))}
      {metric("$1K each → 4pm", fmtMoney(summary.pnl4pm), `${fmtPct(summary.returnOnCapital4pmPct)} on capital`, tone(summary.pnl4pm))}
      {metric("$1K each → 8pm", fmtMoney(summary.pnl8pm), `${fmtPct(summary.returnOnCapital8pmPct)} on capital`, tone(summary.pnl8pm))}
      {metric("20% or 8pm", fmtMoney(summary.pnlTargetOr8pm), `${fmtPct(summary.returnOnCapitalTargetOr8pmPct)} on capital`, tone(summary.pnlTargetOr8pm))}
    </div>
  );
}

function downloadCsv(rows: LongingSignal[], weekStart: string) {
  const columns: Array<[string, (row: LongingSignal) => string | number | boolean | null]> = [
    ["date", (r) => r.etDate], ["ticker", (r) => r.ticker], ["signal_time_et", (r) => r.signalTimeEt],
    ["stale", (r) => r.stale], ["detection_delay_minutes", (r) => r.detectionDelayMinutes], ["signal_price", (r) => r.signalPrice],
    ["signal_rvol", (r) => r.signalRvol], ["setup", (r) => setupLabel(r)], ["rvol_method", (r) => r.rvolMethod], ["volume_at_signal", (r) => r.volumeAtSignal], ["day_volume", (r) => r.dayVolume], ["day_move_8pm_pct", (r) => r.dayMove8pmPct],
    ["return_4pm_pct", (r) => r.return4pmPct], ["return_8pm_pct", (r) => r.return8pmPct], ["max_favorable_pct", (r) => r.maxFavorablePct],
    ["max_adverse_pct", (r) => r.maxAdversePct], ["target_20_hit", (r) => r.target20Hit], ["target_20_time_et", (r) => r.target20TimeEt],
  ];
  const csv = [columns.map(([name]) => name).join(","), ...rows.map((row) => columns.map(([, get]) => JSON.stringify(get(row) ?? "")).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `this-week-in-longing-${weekStart}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function LongingChart({ row, index }: { row: LongingSignal; index: number }) {
  const rootRef = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(index < 2);

  useEffect(() => {
    if (ready || !rootRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin: "900px 0px" },
    );
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <article ref={rootRef} className={styles.chartItem}>
      <div className={styles.chartItemHead}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <strong>{row.ticker}</strong>
        <span>{fmtVolume(row.volumeAtSignal)} at signal</span>
        <span>{fmtVolume(row.dayVolume)} full day</span>
        <span>{row.signalTimeEt} ET · {signalSession(row)} · {setupLabel(row)}</span>
        <span className={tone(row.return8pmPct)}>{fmtPct(row.return8pmPct)} to 8pm</span>
      </div>
      <div className={styles.chartBody}>
        <div className={styles.chartFacts}>
          <span>Signal {fmtPrice(row.signalPrice)}</span>
          <span>Setup {setupLabel(row)}</span>
          <span>RVOL baseline {row.rvolMethod === "historicalTimeOfDay" ? "historical time-of-day" : "same-day rolling"}</span>
          <span>Volume at signal {fmtVolume(row.volumeAtSignal)}</span>
          <span>Full-day volume {fmtVolume(row.dayVolume)}</span>
          <span>Day @ 8pm {fmtPct(row.dayMove8pmPct)}</span>
          <span>MFE {fmtPct(row.maxFavorablePct)}</span>
          <span>MAE {fmtPct(row.maxAdversePct)}</span>
        </div>
        {ready ? (
          <Command2EmbeddedStockChart
            ticker={row.ticker}
            rankLabel={`volume #${index + 1}`}
            etDate={row.etDate}
            initialResolution="5m"
            autoRefresh={false}
            signalUnixSeconds={row.signalUnixSeconds}
            signalLabel="RVOL 5M"
            indicatorSet="core"
          />
        ) : (
          <div className={styles.chartPlaceholder} role="status">Chart loads automatically as you scroll.</div>
        )}
      </div>
    </article>
  );
}

export default function ThisWeekInLongingClient() {
  const [week, setWeek] = useState(mondayInput);
  const [report, setReport] = useState<LongingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("charts");
  const [cohort, setCohort] = useState<Cohort>("all");
  const [signalWindow, setSignalWindow] = useState<SignalWindow>("before11");
  const [day, setDay] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "volumeAtSignal", direction: "desc" });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/command2/this-week-in-longing?week=${week}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "The weekly report could not be loaded.");
        return data as LongingReport;
      })
      .then((data) => { setReport(data); setDay("all"); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The weekly report could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [week]);

  const cohortRows = useMemo(() => (report?.signals ?? []).filter((row) => cohort === "all" || !row.stale), [cohort, report]);
  const timeRows = useMemo(
    () => cohortRows.filter((row) => signalWindow === "all" || isBefore11am(row)),
    [cohortRows, signalWindow],
  );
  const days = useMemo(() => [...new Set(timeRows.map((row) => row.etDate))].sort(), [timeRows]);
  const rows = useMemo(() => {
    const filtered = day === "all" ? timeRows : timeRows.filter((row) => row.etDate === day);
    return [...filtered].sort((a, b) => {
      const av = a[sort.key] ?? (sort.direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      const bv = b[sort.key] ?? (sort.direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      return (Number(av) - Number(bv)) * (sort.direction === "asc" ? 1 : -1);
    });
  }, [day, sort, timeRows]);
  const chartRows = useMemo(
    () => [...timeRows].sort((a, b) => b.volumeAtSignal - a.volumeAtSignal || b.dayVolume - a.dayVolume).slice(0, 30),
    [timeRows],
  );
  const activeSummary = report?.summary[cohort] ?? null;

  function changeSort(key: SortKey) {
    setSort((current) => current.key === key ? { key, direction: current.direction === "desc" ? "asc" : "desc" } : { key, direction: "desc" });
  }

  return (
    <main className={`${styles.page} twilTokens`}>
      <header className={styles.nav}>
        <Link href="/scanner" className={styles.wordmark}>Longboard</Link>
        <nav className={styles.navLinks} aria-label="Weekly report navigation"><Link href="/scanner/this-week-in-longing/stats" className={styles.historyLink}>Stats</Link><Link href="/scanner/history" className={styles.historyLink}>Daily history →</Link></nav>
      </header>

      <section className={styles.intro}>
        <div>
          <p className={styles.kicker}>Weekly 5-minute RVOL audit</p>
          <h1><em>This Week</em> in Longing</h1>
          <p className={styles.lede}>Every saved 5-minute print, measured from its signal bar through the close and the end of extended trading.</p>
        </div>
        <label className={styles.weekPicker}>Week of<input type="date" value={week} onChange={(event) => setWeek(event.target.value)} /></label>
      </section>

      {loading && <div className={styles.loading} role="status" aria-live="polite"><span />Compiling signals and Polygon bars…</div>}
      {error && <div className={styles.error} role="alert"><strong>The report did not load.</strong><span>{error} Refresh the page or choose another week.</span></div>}

      {report && !loading && (
        <>
          <section className={styles.reportHead}>
            <div><span>{fmtDate(report.weekStart)}–{fmtDate(report.weekEnd)}</span><strong>{report.summary.uniqueTickers} tickers · {report.summary.tradingDays} sessions</strong><span>{timeRows.length} signals in the current time window</span></div>
            <div className={styles.cohort} aria-label="Result cohort">
              <button type="button" aria-pressed={cohort === "actionable"} onClick={() => setCohort("actionable")}>Actionable only</button>
              <button type="button" aria-pressed={cohort === "all"} onClick={() => setCohort("all")}>All saved patterns</button>
            </div>
            <div className={styles.cohort} aria-label="Signal time window">
              <button type="button" aria-pressed={signalWindow === "before11"} onClick={() => { setSignalWindow("before11"); setDay("all"); }}>Before 11am ET</button>
              <button type="button" aria-pressed={signalWindow === "all"} onClick={() => { setSignalWindow("all"); setDay("all"); }}>All signal times</button>
            </div>
          </section>
          {activeSummary && summaryCards(activeSummary)}
          <p className={styles.caveat}>{report.summary.staleSignals} saved pattern{report.summary.staleSignals === 1 ? " was" : "s were"} discovered too late for a live entry. They remain in the full research ledger and are excluded when you select “Actionable only.”</p>

          <nav className={styles.tabs} aria-label="Report sections">
            {([ ["charts", "Top 30 charts"], ["ledger", "Signal ledger"], ["method", "Method & caveats"] ] as Array<[Tab, string]>).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>
            ))}
          </nav>

          {tab === "ledger" && (
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div><h2>Signal ledger</h2><p>{rows.length} rows · click a heading to sort</p></div>
                <div className={styles.filters}>
                  <label>Session<select value={day} onChange={(event) => setDay(event.target.value)}><option value="all">All days</option>{days.map((date) => <option key={date} value={date}>{fmtDate(date)}</option>)}</select></label>
                  <button type="button" onClick={() => downloadCsv(rows, report.weekStart)}>Export CSV</button>
                </div>
              </div>
              <div className={styles.tableWrap}>
                <table>
                  <thead><tr>
                    <th>Signal</th>
                    <th><button onClick={() => changeSort("signalUnixSeconds")}>Time {sort.key === "signalUnixSeconds" ? (sort.direction === "desc" ? "↓" : "↑") : ""}</button></th>
                    <th><button onClick={() => changeSort("volumeAtSignal")}>Volume at signal {sort.key === "volumeAtSignal" ? (sort.direction === "desc" ? "↓" : "↑") : ""}</button></th>
                    <th><button onClick={() => changeSort("dayVolume")}>Full-day volume {sort.key === "dayVolume" ? (sort.direction === "desc" ? "↓" : "↑") : ""}</button></th>
                    <th><button onClick={() => changeSort("dayMove8pmPct")}>Day @ 8pm {sort.key === "dayMove8pmPct" ? (sort.direction === "desc" ? "↓" : "↑") : ""}</button></th>
                    <th><button onClick={() => changeSort("return4pmPct")}>To 4pm {sort.key === "return4pmPct" ? (sort.direction === "desc" ? "↓" : "↑") : ""}</button></th>
                    <th><button onClick={() => changeSort("return8pmPct")}>To 8pm {sort.key === "return8pmPct" ? (sort.direction === "desc" ? "↓" : "↑") : ""}</button></th>
                    <th><button onClick={() => changeSort("maxFavorablePct")}>Max after {sort.key === "maxFavorablePct" ? (sort.direction === "desc" ? "↓" : "↑") : ""}</button></th>
                    <th>20% target</th>
                  </tr></thead>
                  <tbody>{rows.map((row) => <tr key={row.alertKey}>
                    <td data-label="Signal"><strong>{row.ticker}</strong><span>{fmtDate(row.etDate)} · {fmtPrice(row.signalPrice)} · {row.signalRvol.toFixed(1)}× · {setupLabel(row)}</span>{row.stale && <mark>late discovery</mark>}</td>
                    <td data-label="Time"><strong>{row.signalTimeEt}</strong><span title="Elapsed time from the signal candle timestamp until Longboard first detected and saved it">detected {row.detectionDelayMinutes.toFixed(0)}m later · {signalSession(row)}</span></td>
                    <td data-label="Volume at signal"><strong>{fmtVolume(row.volumeAtSignal)}</strong></td>
                    <td data-label="Full-day volume"><strong>{fmtVolume(row.dayVolume)}</strong></td>
                    <td data-label="Day @ 8pm" className={tone(row.dayMove8pmPct)}>{fmtPct(row.dayMove8pmPct)}</td>
                    <td data-label="To 4pm" className={tone(row.return4pmPct)}>{fmtPct(row.return4pmPct)}</td>
                    <td data-label="To 8pm" className={tone(row.return8pmPct)}>{fmtPct(row.return8pmPct)}</td>
                    <td data-label="Max after" className={tone(row.maxFavorablePct)}>{fmtPct(row.maxFavorablePct)}</td>
                    <td data-label="20% target"><strong>{row.target20Hit ? "HIT" : "MISS"}</strong><span>{row.target20TimeEt ?? "—"}</span></td>
                  </tr>)}</tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "charts" && (
            <section className={styles.panel}>
              <div className={styles.panelHead}><div><h2>{signalWindow === "before11" ? "Highest volume at signal before 11am" : "Highest volume at signal — all times"}</h2><p>Ranked by cumulative share volume through and including the 5-minute signal candle{signalWindow === "before11" ? ", with signals at or after 11:00am ET excluded" : " across all signal times"}. All charts appear in sequence and load automatically as you scroll.</p></div></div>
              <div className={styles.chartIndex}>{chartRows.map((row, index) => <LongingChart key={row.alertKey} row={row} index={index} />)}</div>
            </section>
          )}

          {tab === "method" && (
            <section className={`${styles.panel} ${styles.method}`}>
              <h2>What the numbers mean</h2>
              <dl>
                <div><dt>Universe</dt><dd>Every row saved in <code>rvol_alert_dispatches</code> at 5-minute resolution during the selected Monday–Friday week.</dd></div>
                <div><dt>Premarket signals</dt><dd>The intraday RVOL scanner begins accepting qualifying signals at 8:00am ET. Signals from 8:00–9:29am are premarket signals; regular trading begins at 9:30am ET.</dd></div>
                <div><dt>Volume</dt><dd>{report.methodology.volumeSession}</dd></div>
                <div><dt>Volume at signal</dt><dd>{report.methodology.volumeAtSignal}</dd></div>
                <div><dt>Day move at 8pm</dt><dd>{report.methodology.dayMoveBaseline}</dd></div>
                <div><dt>$1,000 test</dt><dd>{report.methodology.entryAssumption}</dd></div>
                <div><dt>20% strategy</dt><dd>{report.methodology.targetRule}</dd></div>
                <div><dt>Late discoveries</dt><dd>{report.methodology.staleRule}</dd></div>
              </dl>
              <div className={styles.warning}><strong>This is a signal study, not an executable fill report.</strong><p>Small-cap spreads, halts, slippage, fractional-share availability, commissions, and borrow/locate constraints are not modeled. The next honest upgrade is to store the actual first-seen quote when each signal becomes visible.</p></div>
            </section>
          )}

          <footer className={styles.footer}><p>THIS WEEK IN LONGING · generated {new Date(report.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET · {report.source} · fractional $1,000 positions · no fees or slippage · historical analysis only.</p></footer>
        </>
      )}
    </main>
  );
}
