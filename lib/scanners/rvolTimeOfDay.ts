import type { Bar } from "@/lib/polygon/types";
import { etDateIsoFromUnixSeconds, etMinutesOfDay } from "@/lib/time/etClock";

export type HistoricalRvolMetrics = {
  rvol: number[];
  cumulativeVolumePace: number[];
  baselineSessions: number;
};

function dateKey(time: number) {
  return etDateIsoFromUnixSeconds(time);
}

function clockMinutes(time: number) {
  return etMinutesOfDay(time);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

// One prior session, indexed so each lookup is O(log n) instead of a scan of every bar.
// The sums are built in the same order as the old filter/reduce, so the results are
// bit-for-bit identical (lib/scanners/__tests__/rvolTimeOfDay.test.ts checks this).
type IndexedSession = {
  firstVolumeAtMinute: Map<number, number>;
  cumulativeVolumeThrough: (minute: number) => number;
};

function indexSession(rows: Bar[]): IndexedSession {
  const minutes = rows.map((row) => clockMinutes(row.time));
  const firstVolumeAtMinute = new Map<number, number>();
  rows.forEach((row, index) => {
    if (!firstVolumeAtMinute.has(minutes[index])) firstVolumeAtMinute.set(minutes[index], row.volume);
  });

  const ascending = minutes.every((minute, index) => index === 0 || minutes[index - 1] <= minute);
  if (!ascending) {
    return {
      firstVolumeAtMinute,
      cumulativeVolumeThrough: (minute) =>
        rows
          .filter((_, index) => minutes[index] <= minute)
          .reduce((sum, candidate) => sum + Math.max(0, candidate.volume), 0),
    };
  }

  const prefix: number[] = [];
  let running = 0;
  for (const row of rows) {
    running = running + Math.max(0, row.volume);
    prefix.push(running);
  }
  return {
    firstVolumeAtMinute,
    cumulativeVolumeThrough: (minute) => {
      let lo = 0;
      let hi = minutes.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (minutes[mid] <= minute) lo = mid + 1;
        else hi = mid;
      }
      return lo === 0 ? 0 : prefix[lo - 1];
    },
  };
}

export function historicalTimeOfDayRvol(
  currentBars: Bar[],
  historicalBars: Bar[],
  { sessions = 20, minimumSessions = 5 } = {},
): HistoricalRvolMetrics {
  const grouped = new Map<string, Bar[]>();
  for (const bar of historicalBars) {
    const key = dateKey(bar.time);
    const rows = grouped.get(key);
    if (rows) rows.push(bar);
    else grouped.set(key, [bar]);
  }
  const sessionDates = [...grouped.keys()].sort().slice(-sessions);
  const sessionBars = sessionDates.map((date) => [...(grouped.get(date) ?? [])].sort((a, b) => a.time - b.time));
  if (sessionBars.length < minimumSessions) {
    return {
      rvol: new Array(currentBars.length).fill(NaN),
      cumulativeVolumePace: new Array(currentBars.length).fill(NaN),
      baselineSessions: sessionBars.length,
    };
  }

  const indexed = sessionBars.map(indexSession);
  let currentCumulative = 0;
  const rvol: number[] = [];
  const cumulativeVolumePace: number[] = [];
  for (const bar of currentBars) {
    const minute = clockMinutes(bar.time);
    currentCumulative += Math.max(0, bar.volume);
    const historicalSlotVolumes = indexed.map((session) => session.firstVolumeAtMinute.get(minute) ?? 0);
    const historicalCumulative = indexed.map((session) => session.cumulativeVolumeThrough(minute));
    const slotAverage = average(historicalSlotVolumes);
    const cumulativeAverage = average(historicalCumulative);
    // Keep zero-baseline comparisons finite so they survive JSON and numeric
    // persistence. A one-share denominator preserves their "exceptional" rank.
    rvol.push(bar.volume / Math.max(slotAverage, 1));
    cumulativeVolumePace.push(currentCumulative / Math.max(cumulativeAverage, 1));
  }

  return { rvol, cumulativeVolumePace, baselineSessions: sessionBars.length };
}
