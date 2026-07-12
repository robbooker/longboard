"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { buildLongingTimeBuckets, formatBucketTime, signalTimeToMinutes, type LongingTimeBucket } from "@/lib/longing/stats";
import type { LongingReport, LongingSignal } from "@/lib/longing/types";
import styles from "./stats.module.css";

type Cohort = "all" | "actionable";
type SignalWindow = "all" | "before11";

const ET_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });

function mondayInput(date = new Date()) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + offset);
  return monday.toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  return ET_DATE.format(new Date(`${iso}T16:00:00Z`));
}

function fmtPct(value: number | null, digits = 1) {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function fmtVolume(value: number | null) {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString("en-US");
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function tone(value: number | null) {
  if (value == null || value === 0) return styles.flat;
  return value > 0 ? styles.positive : styles.negative;
}

function SignalsByWindowChart({ buckets }: { buckets: LongingTimeBucket[] }) {
  const width = 1000;
  const height = 390;
  const left = 54;
  const right = 18;
  const top = 24;
  const bottom = 76;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxSignals = Math.max(1, ...buckets.map((bucket) => bucket.signals));
  const step = chartWidth / Math.max(1, buckets.length);
  const barWidth = Math.max(8, step * 0.72);
  const tickCount = Math.min(5, maxSignals + 1);
  const ticks = Array.from({ length: tickCount }, (_, index) => Math.round((maxSignals * index) / Math.max(1, tickCount - 1)));

  return (
    <svg className={styles.svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="signals-title signals-desc">
      <title id="signals-title">Signals by 30-minute Eastern Time window</title>
      <desc id="signals-desc">Stacked bars show actionable and late saved signals in each 30-minute window.</desc>
      {ticks.map((tick) => {
        const y = top + chartHeight - (tick / maxSignals) * chartHeight;
        return <g key={tick}><line className={styles.gridLine} x1={left} x2={width - right} y1={y} y2={y} /><text className={styles.axisText} x={left - 10} y={y + 4} textAnchor="end">{tick}</text></g>;
      })}
      {buckets.map((bucket, index) => {
        const x = left + index * step + (step - barWidth) / 2;
        const actionableHeight = (bucket.actionable / maxSignals) * chartHeight;
        const lateHeight = (bucket.late / maxSignals) * chartHeight;
        const yActionable = top + chartHeight - actionableHeight;
        const yLate = yActionable - lateHeight;
        return (
          <g key={bucket.startMinutes}>
            <title>{bucket.label}–{formatBucketTime(bucket.endMinutes)}: {bucket.signals} signals, {bucket.actionable} actionable, {bucket.late} late</title>
            <rect className={styles.barActionable} x={x} y={yActionable} width={barWidth} height={actionableHeight} />
            <rect className={styles.barLate} x={x} y={yLate} width={barWidth} height={lateHeight} />
            {bucket.signals > 0 && <text className={styles.valueText} x={x + barWidth / 2} y={Math.max(top + 12, yLate - 7)} textAnchor="middle">{bucket.signals}</text>}
            <text className={styles.xLabel} transform={`translate(${x + barWidth / 2}, ${height - bottom + 19}) rotate(-42)`} textAnchor="end">{bucket.label}</text>
          </g>
        );
      })}
      <line className={styles.axisLine} x1={left} x2={width - right} y1={top + chartHeight} y2={top + chartHeight} />
    </svg>
  );
}

function SignalScatterChart({ rows, endMinutes }: { rows: LongingSignal[]; endMinutes: number }) {
  const width = 1000;
  const height = 410;
  const left = 72;
  const right = 24;
  const top = 24;
  const bottom = 62;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const startMinutes = 8 * 60;
  const positiveVolumes = rows.map((row) => row.volumeAtSignal).filter((value) => value > 0);
  const minLog = positiveVolumes.length ? Math.floor(Math.log10(Math.min(...positiveVolumes))) : 3;
  const maxLog = positiveVolumes.length ? Math.ceil(Math.log10(Math.max(...positiveVolumes))) : 8;
  const logSpan = Math.max(1, maxLog - minLog);
  const x = (minutes: number) => left + ((minutes - startMinutes) / Math.max(1, endMinutes - startMinutes)) * chartWidth;
  const y = (volume: number) => top + chartHeight - ((Math.log10(Math.max(1, volume)) - minLog) / logSpan) * chartHeight;
  const timeTicks: number[] = [];
  for (let minute = startMinutes; minute <= endMinutes; minute += 60) timeTicks.push(minute);
  const volumeTicks = Array.from({ length: logSpan + 1 }, (_, index) => minLog + index);

  return (
    <svg className={styles.svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="scatter-title scatter-desc">
      <title id="scatter-title">Signal time compared with volume at signal</title>
      <desc id="scatter-desc">Each dot is a saved signal. The vertical volume scale is logarithmic. Green finished higher by 8pm and red finished lower.</desc>
      {volumeTicks.map((power) => {
        const tickY = y(10 ** power);
        return <g key={power}><line className={styles.gridLine} x1={left} x2={width - right} y1={tickY} y2={tickY} /><text className={styles.axisText} x={left - 12} y={tickY + 4} textAnchor="end">{fmtVolume(10 ** power)}</text></g>;
      })}
      {timeTicks.map((minute) => <g key={minute}><line className={styles.gridLineVertical} x1={x(minute)} x2={x(minute)} y1={top} y2={top + chartHeight} /><text className={styles.axisText} x={x(minute)} y={height - bottom + 25} textAnchor="middle">{formatBucketTime(minute)}</text></g>)}
      {rows.map((row) => (
        <circle
          key={row.alertKey}
          className={`${styles.dot} ${row.return8pmPct == null ? styles.dotFlat : row.return8pmPct >= 0 ? styles.dotPositive : styles.dotNegative} ${row.stale ? styles.dotLate : ""}`}
          cx={x(signalTimeToMinutes(row.signalTimeEt))}
          cy={y(row.volumeAtSignal)}
          r={6}
        >
          <title>{row.ticker} · {row.signalTimeEt} ET · {fmtVolume(row.volumeAtSignal)} volume · {fmtPct(row.return8pmPct)} to 8pm{row.stale ? " · late discovery" : ""}</title>
        </circle>
      ))}
      <line className={styles.axisLine} x1={left} x2={width - right} y1={top + chartHeight} y2={top + chartHeight} />
      <text className={styles.axisTitle} x={left + chartWidth / 2} y={height - 8} textAnchor="middle">Signal time · Eastern</text>
      <text className={styles.axisTitle} transform={`translate(17 ${top + chartHeight / 2}) rotate(-90)`} textAnchor="middle">Volume at signal · log scale</text>
    </svg>
  );
}

function PerformanceByWindowChart({ buckets }: { buckets: LongingTimeBucket[] }) {
  const width = 1000;
  const height = 390;
  const left = 58;
  const right = 18;
  const top = 30;
  const bottom = 76;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const values = buckets.flatMap((bucket) => [bucket.medianReturn4pmPct, bucket.medianReturn8pmPct]).filter((value): value is number => value != null);
  const bound = Math.max(5, Math.ceil(Math.max(...values.map(Math.abs), 0) / 5) * 5);
  const step = chartWidth / Math.max(1, buckets.length);
  const x = (index: number) => left + index * step + step / 2;
  const y = (value: number) => top + ((bound - value) / (bound * 2)) * chartHeight;
  const ticks = [-bound, -bound / 2, 0, bound / 2, bound];
  const series = [
    { key: "four", label: "Median to 4pm", get: (bucket: LongingTimeBucket) => bucket.medianReturn4pmPct, className: styles.lineFour },
    { key: "eight", label: "Median to 8pm", get: (bucket: LongingTimeBucket) => bucket.medianReturn8pmPct, className: styles.lineEight },
  ];

  return (
    <svg className={styles.svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="performance-title performance-desc">
      <title id="performance-title">Median post-signal return by 30-minute window</title>
      <desc id="performance-desc">Two lines compare the median return from signal to 4pm and to 8pm for each time window.</desc>
      {ticks.map((tick) => <g key={tick}><line className={tick === 0 ? styles.zeroLine : styles.gridLine} x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text className={styles.axisText} x={left - 10} y={y(tick) + 4} textAnchor="end">{tick}%</text></g>)}
      {series.map((item) => {
        const points = buckets.map((bucket, index) => ({ index, value: item.get(bucket) })).filter((point): point is { index: number; value: number } => point.value != null);
        return <g key={item.key}><polyline className={item.className} points={points.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} />{points.map((point) => <circle key={point.index} className={item.className} cx={x(point.index)} cy={y(point.value)} r={5}><title>{buckets[point.index].label}: {item.label} {fmtPct(point.value)}</title></circle>)}</g>;
      })}
      {buckets.map((bucket, index) => <text key={bucket.startMinutes} className={styles.xLabel} transform={`translate(${x(index)}, ${height - bottom + 19}) rotate(-42)`} textAnchor="end">{bucket.label}</text>)}
      <line className={styles.axisLine} x1={left} x2={width - right} y1={top + chartHeight} y2={top + chartHeight} />
    </svg>
  );
}

function ChartSection({ eyebrow, title, description, legend, children }: { eyebrow: string; title: string; description: string; legend?: ReactNode; children: ReactNode }) {
  return <section className={styles.chartSection}><header><div><p>{eyebrow}</p><h2>{title}</h2><span>{description}</span></div>{legend}</header><div className={styles.chartCanvas}>{children}</div></section>;
}

export default function LongingStatsClient() {
  const [week, setWeek] = useState(mondayInput);
  const [report, setReport] = useState<LongingReport | null>(null);
  const [cohort, setCohort] = useState<Cohort>("all");
  const [signalWindow, setSignalWindow] = useState<SignalWindow>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      .then(setReport)
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The weekly report could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [week]);

  const rows = useMemo(() => (report?.signals ?? []).filter((row) => (cohort === "all" || !row.stale) && (signalWindow === "all" || row.signalTimeEt < "11:00")), [cohort, report, signalWindow]);
  const endMinutes = signalWindow === "before11" ? 11 * 60 : 16 * 60 + 30;
  const buckets = useMemo(() => buildLongingTimeBuckets(rows, { endMinutes }), [endMinutes, rows]);
  const busiest = useMemo(() => buckets.reduce<LongingTimeBucket | null>((best, bucket) => !best || bucket.signals > best.signals ? bucket : best, null), [buckets]);
  const best8pm = useMemo(() => buckets.filter((bucket) => bucket.medianReturn8pmPct != null).reduce<LongingTimeBucket | null>((best, bucket) => !best || (bucket.medianReturn8pmPct ?? -Infinity) > (best.medianReturn8pmPct ?? -Infinity) ? bucket : best, null), [buckets]);
  const before11Count = rows.filter((row) => row.signalTimeEt < "11:00").length;
  const actionableCount = rows.filter((row) => !row.stale).length;
  const completed8pm = rows.filter((row) => row.return8pmPct != null);

  return (
    <main className={`${styles.page} twilTokens`}>
      <header className={styles.nav}>
        <Link href="/scanner" className={styles.wordmark}>Longboard</Link>
        <nav aria-label="This Week in Longing"><Link href="/scanner/this-week-in-longing">Weekly report</Link><Link href="/scanner/history">Daily history</Link></nav>
      </header>

      <section className={styles.intro}>
        <div><p className={styles.kicker}>Timing and follow-through</p><h1><em>This Week in Longing</em> / Stats</h1><p className={styles.lede}>When signals arrive, how much liquidity is already present, and whether timing changes what happens next.</p></div>
        <label className={styles.weekPicker}>Week of<input type="date" value={week} onChange={(event) => setWeek(event.target.value)} /></label>
      </section>

      {loading && <div className={styles.loading} role="status" aria-live="polite"><span />Compiling the weekly distribution…</div>}
      {error && <div className={styles.error} role="alert"><strong>The stats did not load.</strong><span>{error}</span></div>}

      {report && !loading && (
        <>
          <section className={styles.controlRail}>
            <div><span>{fmtDate(report.weekStart)}–{fmtDate(report.weekEnd)}</span><strong>{rows.length} signals in view</strong></div>
            <div className={styles.buttonGroup} aria-label="Signal cohort"><button type="button" aria-pressed={cohort === "all"} onClick={() => setCohort("all")}>All saved patterns</button><button type="button" aria-pressed={cohort === "actionable"} onClick={() => setCohort("actionable")}>Actionable only</button></div>
            <div className={styles.buttonGroup} aria-label="Signal time range"><button type="button" aria-pressed={signalWindow === "all"} onClick={() => setSignalWindow("all")}>Full signal day</button><button type="button" aria-pressed={signalWindow === "before11"} onClick={() => setSignalWindow("before11")}>Before 11am ET</button></div>
          </section>

          <section className={styles.statStrip} aria-label="Current view summary">
            <div><span>Busiest window</span><strong>{busiest?.signals ? busiest.label : "—"}</strong><small>{busiest?.signals ?? 0} signals</small></div>
            <div><span>Before 11am</span><strong>{rows.length ? `${((before11Count / rows.length) * 100).toFixed(0)}%` : "—"}</strong><small>{before11Count} of {rows.length}</small></div>
            <div><span>Median volume at signal</span><strong>{fmtVolume(median(rows.map((row) => row.volumeAtSignal)))}</strong><small>cumulative shares</small></div>
            <div><span>Best median to 8pm</span><strong className={tone(best8pm?.medianReturn8pmPct ?? null)}>{best8pm ? fmtPct(best8pm.medianReturn8pmPct) : "—"}</strong><small>{best8pm?.label ?? "no completed rows"}</small></div>
            <div><span>Actionable share</span><strong>{rows.length ? `${((actionableCount / rows.length) * 100).toFixed(0)}%` : "—"}</strong><small>{actionableCount} timely detections</small></div>
          </section>

          <ChartSection eyebrow="Distribution" title="Signals by 30-minute window" description="The count itself reveals concentration. Bars split timely detections from patterns saved too late to act on." legend={<div className={styles.legend}><span><i className={styles.swatchActionable} />Actionable</span><span><i className={styles.swatchLate} />Late</span></div>}>
            <SignalsByWindowChart buckets={buckets} />
          </ChartSection>

          <ChartSection eyebrow="Liquidity map" title="Signal time × volume at signal" description="A log scale keeps low- and high-volume names legible together. Hover a point for the ticker, time, volume, and 8pm result." legend={<div className={styles.legend}><span><i className={styles.swatchPositive} />Higher at 8pm</span><span><i className={styles.swatchNegative} />Lower at 8pm</span></div>}>
            <SignalScatterChart rows={rows} endMinutes={endMinutes} />
          </ChartSection>

          <ChartSection eyebrow="Outcome" title="Median follow-through by signal window" description="Medians reduce the influence of one extreme small-cap move. This compares holding to 4pm with holding through 8pm." legend={<div className={styles.legend}><span><i className={styles.lineKeyFour} />To 4pm</span><span><i className={styles.lineKeyEight} />To 8pm</span></div>}>
            <PerformanceByWindowChart buckets={buckets} />
          </ChartSection>

          <section className={styles.tableSection}>
            <header><div><p>Exact readout</p><h2>Window-by-window stats</h2></div><span>Empty windows stay visible so gaps are not disguised.</span></header>
            <div className={styles.tableWrap}><table><thead><tr><th>Window ET</th><th>Signals</th><th>Actionable</th><th>Median volume</th><th>Median → 4pm</th><th>Median → 8pm</th><th>8pm win rate</th><th>20% hit rate</th></tr></thead><tbody>{buckets.map((bucket) => <tr key={bucket.startMinutes}><td data-label="Window ET">{bucket.label}–{formatBucketTime(bucket.endMinutes)}</td><td data-label="Signals">{bucket.signals}</td><td data-label="Actionable">{bucket.signals ? `${((bucket.actionable / bucket.signals) * 100).toFixed(0)}%` : "—"}</td><td data-label="Median volume">{fmtVolume(bucket.medianVolumeAtSignal)}</td><td data-label="Median to 4pm" className={tone(bucket.medianReturn4pmPct)}>{fmtPct(bucket.medianReturn4pmPct)}</td><td data-label="Median to 8pm" className={tone(bucket.medianReturn8pmPct)}>{fmtPct(bucket.medianReturn8pmPct)}</td><td data-label="8pm win rate">{bucket.winRate8pmPct == null ? "—" : `${bucket.winRate8pmPct.toFixed(0)}%`}</td><td data-label="20% hit rate">{bucket.target20HitRatePct == null ? "—" : `${bucket.target20HitRatePct.toFixed(0)}%`}</td></tr>)}</tbody></table></div>
          </section>

          <section className={styles.nextSection}>
            <header><p>What I would add next</p><h2>Data that answers the harder questions</h2></header>
            <ol>
              <li><strong>Volume percentile, not only raw volume</strong><span>Compare volume at signal with that ticker’s own typical volume by the same time of day.</span></li>
              <li><strong>Float and market-cap bands</strong><span>Separate true liquidity from a high-volume, ultra-low-float event.</span></li>
              <li><strong>Time to high and drawdown first</strong><span>Show whether the winner was realistically holdable before reaching its maximum favorable move.</span></li>
              <li><strong>Spread, slippage, and halt rate</strong><span>Convert the theoretical $1,000 study into a more executable result.</span></li>
              <li><strong>Repeat-ticker and catalyst tags</strong><span>Distinguish independent signals from one stock appearing repeatedly or moving on a specific catalyst.</span></li>
              <li><strong>Volume-at-signal × return scatter</strong><span>Test the central hypothesis directly: whether more early liquidity actually predicts better follow-through.</span></li>
            </ol>
          </section>

          <footer className={styles.footer}>THIS WEEK IN LONGING / STATS · {completed8pm.length} signals with an 8pm outcome · 30-minute Eastern Time windows · medians shown where noted · historical analysis only.</footer>
        </>
      )}
    </main>
  );
}
