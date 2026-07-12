import type { LongingSignal } from "./types";

export type LongingTimeBucket = {
  startMinutes: number;
  endMinutes: number;
  label: string;
  signals: number;
  actionable: number;
  late: number;
  medianVolumeAtSignal: number | null;
  medianReturn4pmPct: number | null;
  medianReturn8pmPct: number | null;
  winRate8pmPct: number | null;
  target20HitRatePct: number | null;
};

export function signalTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatBucketTime(minutes: number) {
  const hours24 = Math.floor(minutes / 60);
  const minutesPart = minutes % 60;
  const suffix = hours24 >= 12 ? "pm" : "am";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutesPart).padStart(2, "0")}${suffix}`;
}

function median(values: Array<number | null>) {
  const usable = values.filter((value): value is number => value != null).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

function rate(numerator: number, denominator: number) {
  return denominator ? (numerator / denominator) * 100 : null;
}

export function buildLongingTimeBuckets(
  signals: LongingSignal[],
  { startMinutes = 8 * 60, endMinutes = 16 * 60, bucketMinutes = 30 } = {},
): LongingTimeBucket[] {
  const buckets: LongingTimeBucket[] = [];
  for (let start = startMinutes; start < endMinutes; start += bucketMinutes) {
    const rows = signals.filter((signal) => {
      const time = signalTimeToMinutes(signal.signalTimeEt);
      return time >= start && time < start + bucketMinutes;
    });
    const return8Rows = rows.filter((row) => row.return8pmPct != null);
    buckets.push({
      startMinutes: start,
      endMinutes: start + bucketMinutes,
      label: formatBucketTime(start),
      signals: rows.length,
      actionable: rows.filter((row) => !row.stale).length,
      late: rows.filter((row) => row.stale).length,
      medianVolumeAtSignal: median(rows.map((row) => row.volumeAtSignal)),
      medianReturn4pmPct: median(rows.map((row) => row.return4pmPct)),
      medianReturn8pmPct: median(rows.map((row) => row.return8pmPct)),
      winRate8pmPct: rate(return8Rows.filter((row) => (row.return8pmPct ?? 0) > 0).length, return8Rows.length),
      target20HitRatePct: rate(rows.filter((row) => row.target20Hit).length, rows.length),
    });
  }
  return buckets;
}
