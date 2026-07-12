import { describe, expect, it } from "vitest";
import type { LongingSignal } from "../types";
import { buildLongingTimeBuckets, formatBucketTime, signalTimeToMinutes } from "../stats";

function signal(overrides: Partial<LongingSignal>): LongingSignal {
  return {
    alertKey: "test",
    etDate: "2026-07-10",
    ticker: "TEST",
    signalUnixSeconds: 0,
    signalTimeEt: "09:30",
    detectedAt: "2026-07-10T13:35:00Z",
    detectionDelayMinutes: 5,
    signalRvol: 8,
    signalPrice: 10,
    signalDayMovePct: 20,
    breakoutMode: "premarketHigh",
    rvolMethod: "sameDayRolling",
    status: "sent",
    stale: false,
    volumeAtSignal: 1_000_000,
    dayVolume: 2_000_000,
    close4pm: 11,
    close8pm: 12,
    dayMove8pmPct: 30,
    return4pmPct: 10,
    return8pmPct: 20,
    maxFavorablePct: 25,
    maxAdversePct: -5,
    target20Hit: true,
    target20TimeEt: "10:00",
    pnl4pm: 100,
    pnl8pm: 200,
    pnlTargetOr8pm: 200,
    ...overrides,
  };
}

describe("longing time buckets", () => {
  it("parses and formats Eastern signal times", () => {
    expect(signalTimeToMinutes("09:35")).toBe(575);
    expect(formatBucketTime(8 * 60)).toBe("8:00am");
    expect(formatBucketTime(13 * 60 + 30)).toBe("1:30pm");
  });

  it("includes boundary signals in the correct 30-minute window", () => {
    const buckets = buildLongingTimeBuckets([
      signal({ alertKey: "a", signalTimeEt: "09:29", volumeAtSignal: 2_000_000, return8pmPct: -10, stale: true, target20Hit: false }),
      signal({ alertKey: "b", signalTimeEt: "09:30", volumeAtSignal: 4_000_000, return8pmPct: 20 }),
      signal({ alertKey: "c", signalTimeEt: "09:55", volumeAtSignal: 8_000_000, return8pmPct: 10 }),
    ], { startMinutes: 9 * 60, endMinutes: 10 * 60 });

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ label: "9:00am", signals: 1, actionable: 0, late: 1, winRate8pmPct: 0 });
    expect(buckets[1]).toMatchObject({ label: "9:30am", signals: 2, actionable: 2, late: 0, medianVolumeAtSignal: 6_000_000, medianReturn8pmPct: 15, winRate8pmPct: 100, target20HitRatePct: 100 });
  });

  it("keeps empty windows so timing gaps remain visible", () => {
    const buckets = buildLongingTimeBuckets([], { startMinutes: 8 * 60, endMinutes: 9 * 60 });
    expect(buckets.map((bucket) => bucket.signals)).toEqual([0, 0]);
    expect(buckets[0].medianReturn8pmPct).toBeNull();
  });
});
