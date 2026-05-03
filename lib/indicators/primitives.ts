import type { Bar } from "@/lib/polygon/types";

const NY_TZ = "America/New_York";

// Exponential moving average. Returns an array the same length as `values`,
// with NaN for indices where the warmup period has not completed.
export function ema(values: number[], period: number): number[] {
  if (period <= 0) throw new Error(`ema: period must be > 0, got ${period}`);
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    const next = values[i] * k + prev * (1 - k);
    out[i] = next;
    prev = next;
  }
  return out;
}

// Simple moving average. Returns NaN for indices < period - 1.
export function sma(values: number[], period: number): number[] {
  if (period <= 0) throw new Error(`sma: period must be > 0, got ${period}`);
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

// Session-anchored VWAP. Resets at the first bar of each ET trading day.
// Uses typical price (HLC/3) weighted by volume.
export function vwap(bars: Bar[]): number[] {
  const out: number[] = new Array(bars.length).fill(NaN);
  const dayMarkers = newDayMarkers(bars);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    if (dayMarkers[i]) {
      cumPV = 0;
      cumV = 0;
    }
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    cumPV += tp * bars[i].volume;
    cumV += bars[i].volume;
    out[i] = cumV > 0 ? cumPV / cumV : NaN;
  }
  return out;
}

// True at index i when a[i-1] >= b[i-1] AND a[i] < b[i].
export function crossunder(a: number[], b: number[]): boolean[] {
  const n = Math.max(a.length, b.length);
  const out: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const a0 = a[i - 1];
    const a1 = a[i];
    const b0 = b[i - 1];
    const b1 = b[i];
    if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(b0) || !Number.isFinite(b1)) continue;
    if (a0 >= b0 && a1 < b1) out[i] = true;
  }
  return out;
}

// True at index i when a[i-1] <= b[i-1] AND a[i] > b[i].
export function crossover(a: number[], b: number[]): boolean[] {
  const n = Math.max(a.length, b.length);
  const out: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const a0 = a[i - 1];
    const a1 = a[i];
    const b0 = b[i - 1];
    const b1 = b[i];
    if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(b0) || !Number.isFinite(b1)) continue;
    if (a0 <= b0 && a1 > b1) out[i] = true;
  }
  return out;
}

type EtClock = { year: number; month: number; day: number; hour: number; minute: number };

function etClock(unixSeconds: number): EtClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(unixSeconds * 1000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

// 4:00am–9:30am ET (exclusive of 9:30 itself — that's the regular session open bar).
export function isPremarket(unixSeconds: number): boolean {
  const c = etClock(unixSeconds);
  const minutes = c.hour * 60 + c.minute;
  return minutes >= 240 && minutes < 570;
}

// 9:30am–4:00pm ET (4:00pm exclusive — the 16:00 close bar belongs to after-hours).
export function isRegularSession(unixSeconds: number): boolean {
  const c = etClock(unixSeconds);
  const minutes = c.hour * 60 + c.minute;
  return minutes >= 570 && minutes < 960;
}

// True on the first bar whose ET calendar date differs from the previous bar's.
// Index 0 is always true (start of dataset = start of the first day).
export function newDayMarkers(bars: Bar[]): boolean[] {
  const out: boolean[] = new Array(bars.length).fill(false);
  if (bars.length === 0) return out;
  out[0] = true;
  let prev = etClock(bars[0].time);
  for (let i = 1; i < bars.length; i++) {
    const cur = etClock(bars[i].time);
    if (cur.year !== prev.year || cur.month !== prev.month || cur.day !== prev.day) {
      out[i] = true;
    }
    prev = cur;
  }
  return out;
}
