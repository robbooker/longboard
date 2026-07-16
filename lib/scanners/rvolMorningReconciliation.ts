import type { Bar } from "@/lib/polygon/types";
import { formatEtTime } from "@/lib/polygon/client";

export type QualifiedRvolDiagnostic = {
  et_date: string;
  ticker: string;
  best_bar_unix_seconds: number | string;
  best_bar_time_et: string | null;
  signal_rvol: number | string;
  breakout_level: number | string | null;
  breakout_mode: "premarketHigh" | "openingRangeHigh";
  rvol_method: "sameDayRolling" | "historicalTimeOfDay";
};

export type ReconciledDispatchRow = {
  alert_key: string;
  et_date: string;
  ticker: string;
  signal_resolution: "5m";
  signal_unix_seconds: number;
  signal_time_et: string;
  signal_rvol: number;
  signal_price: number;
  change_pct: number;
  signal_breakout_mode: QualifiedRvolDiagnostic["breakout_mode"];
  breakout_level: number | null;
  rvol_method: QualifiedRvolDiagnostic["rvol_method"];
  signal_origin: "historical_backtest";
  status: "skipped";
  recipients_count: 0;
  browser_push_recipients_count: 0;
  email_recipients_count: 0;
  error: string;
};

const ET_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function etDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export function previousWeekdayEtDate(now: Date = new Date()): string {
  const { year, month, day } = etDateParts(now);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

export function reconciledAlertKey(diagnostic: QualifiedRvolDiagnostic): string | null {
  const signalUnixSeconds = finiteNumber(diagnostic.best_bar_unix_seconds);
  if (signalUnixSeconds == null) return null;
  return `${diagnostic.et_date}:5m:${diagnostic.ticker.trim().toUpperCase()}:${signalUnixSeconds}`;
}

export function buildReconciledDispatchRow(
  diagnostic: QualifiedRvolDiagnostic,
  intradayBars: Bar[],
  dailyBars: Bar[],
): ReconciledDispatchRow | null {
  const signalUnixSeconds = finiteNumber(diagnostic.best_bar_unix_seconds);
  const signalRvol = finiteNumber(diagnostic.signal_rvol);
  if (signalUnixSeconds == null || signalRvol == null) return null;

  const signalBar = intradayBars.find((bar) => bar.time === signalUnixSeconds);
  const previousDailyBar = [...dailyBars]
    .sort((a, b) => a.time - b.time)
    .filter((bar) => ET_DATE_FORMAT.format(new Date(bar.time * 1000)) < diagnostic.et_date)
    .at(-1);
  if (!signalBar || !previousDailyBar || previousDailyBar.close <= 0 || signalBar.close <= 0) return null;

  const ticker = diagnostic.ticker.trim().toUpperCase();
  const breakoutLevel = finiteNumber(diagnostic.breakout_level);
  return {
    alert_key: `${diagnostic.et_date}:5m:${ticker}:${signalUnixSeconds}`,
    et_date: diagnostic.et_date,
    ticker,
    signal_resolution: "5m",
    signal_unix_seconds: signalUnixSeconds,
    signal_time_et: diagnostic.best_bar_time_et ?? formatEtTime(signalUnixSeconds),
    signal_rvol: signalRvol,
    signal_price: signalBar.close,
    change_pct: ((signalBar.close - previousDailyBar.close) / previousDailyBar.close) * 100,
    signal_breakout_mode: diagnostic.breakout_mode,
    breakout_level: breakoutLevel,
    rvol_method: diagnostic.rvol_method,
    signal_origin: "historical_backtest",
    status: "skipped",
    recipients_count: 0,
    browser_push_recipients_count: 0,
    email_recipients_count: 0,
    error: "Morning reconciliation restored a qualified 5-minute signal missing from live dispatch history.",
  };
}
