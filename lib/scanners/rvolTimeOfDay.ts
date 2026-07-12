import type { Bar } from "@/lib/polygon/types";

const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ET_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

export type HistoricalRvolMetrics = {
  rvol: number[];
  cumulativeVolumePace: number[];
  baselineSessions: number;
};

function dateKey(time: number) {
  return ET_DATE.format(new Date(time * 1000));
}

function clockMinutes(time: number) {
  const parts = ET_CLOCK.formatToParts(new Date(time * 1000));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

export function historicalTimeOfDayRvol(
  currentBars: Bar[],
  historicalBars: Bar[],
  { sessions = 20, minimumSessions = 5 } = {},
): HistoricalRvolMetrics {
  const grouped = new Map<string, Bar[]>();
  for (const bar of historicalBars) {
    const key = dateKey(bar.time);
    grouped.set(key, [...(grouped.get(key) ?? []), bar]);
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

  let currentCumulative = 0;
  const rvol: number[] = [];
  const cumulativeVolumePace: number[] = [];
  for (const bar of currentBars) {
    const minute = clockMinutes(bar.time);
    currentCumulative += Math.max(0, bar.volume);
    const historicalSlotVolumes = sessionBars.map((rows) =>
      rows.find((candidate) => clockMinutes(candidate.time) === minute)?.volume ?? 0,
    );
    const historicalCumulative = sessionBars.map((rows) =>
      rows
        .filter((candidate) => clockMinutes(candidate.time) <= minute)
        .reduce((sum, candidate) => sum + Math.max(0, candidate.volume), 0),
    );
    const slotAverage = average(historicalSlotVolumes);
    const cumulativeAverage = average(historicalCumulative);
    // Keep zero-baseline comparisons finite so they survive JSON and numeric
    // persistence. A one-share denominator preserves their "exceptional" rank.
    rvol.push(bar.volume / Math.max(slotAverage, 1));
    cumulativeVolumePace.push(currentCumulative / Math.max(cumulativeAverage, 1));
  }

  return { rvol, cumulativeVolumePace, baselineSessions: sessionBars.length };
}
