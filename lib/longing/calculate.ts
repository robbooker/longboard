import type { Bar } from "@/lib/polygon/types";
import type { LongingCohortSummary, LongingSignal, LongingSignalStatus } from "./types";

export type StoredLongingSignal = {
  alert_key: string;
  et_date: string;
  ticker: string;
  signal_unix_seconds: number | string;
  signal_time_et: string;
  signal_rvol: number | string;
  signal_price: number | string;
  change_pct: number | string;
  status: LongingSignalStatus;
  error: string | null;
  created_at: string;
};

const POSITION_SIZE = 1_000;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function pct(from: number, to: number): number {
  return round(((to / from) - 1) * 100);
}

function etClock(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1000));
}

function clockMinutes(unixSeconds: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(unixSeconds * 1000));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function closeAtOrBefore(bars: Bar[], minute: number): number | null {
  const candidates = bars.filter((bar) => clockMinutes(bar.time) <= minute);
  return candidates.at(-1)?.close ?? null;
}

function staleSignal(row: StoredLongingSignal, delayMinutes: number): boolean {
  return row.error?.toLowerCase().includes("older than") === true || delayMinutes > 10;
}

export function calculateLongingSignal(row: StoredLongingSignal, bars: Bar[]): LongingSignal | null {
  const signalUnixSeconds = finite(row.signal_unix_seconds);
  const signalRvol = finite(row.signal_rvol);
  const signalPrice = finite(row.signal_price);
  const signalDayMovePct = finite(row.change_pct);
  if (signalUnixSeconds == null || signalRvol == null || signalPrice == null || signalPrice <= 0 || signalDayMovePct == null) {
    return null;
  }

  const orderedBars = [...bars].sort((a, b) => a.time - b.time);
  const postSignal = orderedBars.filter((bar) => bar.time > signalUnixSeconds);
  const close4pm = closeAtOrBefore(orderedBars, 16 * 60);
  const close8pm = closeAtOrBefore(orderedBars, 20 * 60);
  const previousClose = signalPrice / (1 + signalDayMovePct / 100);
  const targetPrice = signalPrice * 1.2;
  const targetBar = postSignal.find((bar) => bar.high >= targetPrice) ?? null;
  const maxHigh = postSignal.length > 0 ? Math.max(...postSignal.map((bar) => bar.high)) : null;
  const minLow = postSignal.length > 0 ? Math.min(...postSignal.map((bar) => bar.low)) : null;
  const detectedMs = new Date(row.created_at).getTime();
  const delayMinutes = Number.isFinite(detectedMs)
    ? Math.max(0, (detectedMs / 1000 - signalUnixSeconds) / 60)
    : 0;
  const return4pmPct = close4pm == null ? null : pct(signalPrice, close4pm);
  const return8pmPct = close8pm == null ? null : pct(signalPrice, close8pm);
  const pnl4pm = return4pmPct == null ? null : round(POSITION_SIZE * return4pmPct / 100, 2);
  const pnl8pm = return8pmPct == null ? null : round(POSITION_SIZE * return8pmPct / 100, 2);
  const pnlTargetOr8pm = targetBar
    ? POSITION_SIZE * 0.2
    : pnl8pm;

  return {
    alertKey: row.alert_key,
    etDate: row.et_date,
    ticker: row.ticker.trim().toUpperCase(),
    signalUnixSeconds,
    signalTimeEt: row.signal_time_et,
    detectedAt: row.created_at,
    detectionDelayMinutes: round(delayMinutes, 1),
    signalRvol: round(signalRvol),
    signalPrice: round(signalPrice),
    signalDayMovePct: round(signalDayMovePct),
    status: row.status,
    stale: staleSignal(row, delayMinutes),
    dayVolume: orderedBars.reduce((sum, bar) => sum + Math.max(0, bar.volume), 0),
    close4pm,
    close8pm,
    dayMove8pmPct: close8pm == null ? null : pct(previousClose, close8pm),
    return4pmPct,
    return8pmPct,
    maxFavorablePct: maxHigh == null ? null : pct(signalPrice, maxHigh),
    maxAdversePct: minLow == null ? null : pct(signalPrice, minLow),
    target20Hit: targetBar != null,
    target20TimeEt: targetBar ? etClock(targetBar.time) : null,
    pnl4pm,
    pnl8pm,
    pnlTargetOr8pm: pnlTargetOr8pm == null ? null : round(pnlTargetOr8pm, 2),
  };
}

function values(rows: LongingSignal[], key: keyof LongingSignal): number[] {
  return rows
    .map((row) => row[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function average(input: number[]): number | null {
  return input.length === 0 ? null : round(input.reduce((sum, value) => sum + value, 0) / input.length);
}

function median(input: number[]): number | null {
  if (input.length === 0) return null;
  const ordered = [...input].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? round((ordered[middle - 1] + ordered[middle]) / 2)
    : ordered[middle];
}

function rate(input: number[], predicate: (value: number) => boolean): number | null {
  return input.length === 0 ? null : round(input.filter(predicate).length / input.length * 100);
}

export function summarizeLongingSignals(rows: LongingSignal[]): LongingCohortSummary {
  const r4 = values(rows, "return4pmPct");
  const r8 = values(rows, "return8pmPct");
  const mfe = values(rows, "maxFavorablePct");
  const mae = values(rows, "maxAdversePct");
  const pnl4pm = round(values(rows, "pnl4pm").reduce((sum, value) => sum + value, 0), 2);
  const pnl8pm = round(values(rows, "pnl8pm").reduce((sum, value) => sum + value, 0), 2);
  const pnlTargetOr8pm = round(values(rows, "pnlTargetOr8pm").reduce((sum, value) => sum + value, 0), 2);
  const capitalDeployed = rows.length * POSITION_SIZE;
  const targetEligible = rows.filter((row) => row.return8pmPct != null);

  return {
    signals: rows.length,
    capitalDeployed,
    average4pmPct: average(r4),
    median4pmPct: median(r4),
    average8pmPct: average(r8),
    median8pmPct: median(r8),
    averageMaxFavorablePct: average(mfe),
    averageMaxAdversePct: average(mae),
    winRate4pmPct: rate(r4, (value) => value > 0),
    winRate8pmPct: rate(r8, (value) => value > 0),
    target20HitRatePct: targetEligible.length === 0
      ? null
      : round(targetEligible.filter((row) => row.target20Hit).length / targetEligible.length * 100),
    pnl4pm,
    pnl8pm,
    pnlTargetOr8pm,
    returnOnCapital4pmPct: capitalDeployed === 0 ? null : round(pnl4pm / capitalDeployed * 100),
    returnOnCapital8pmPct: capitalDeployed === 0 ? null : round(pnl8pm / capitalDeployed * 100),
    returnOnCapitalTargetOr8pmPct: capitalDeployed === 0 ? null : round(pnlTargetOr8pm / capitalDeployed * 100),
  };
}

export function mondayForEtDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).split("-").map(Number);
  const utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const day = utc.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + offset);
  return utc.toISOString().slice(0, 10);
}

export function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
