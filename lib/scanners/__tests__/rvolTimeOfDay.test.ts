import { describe, expect, it } from "vitest";
import { nyClockToUtcMs } from "@/lib/polygon/client";
import type { Bar } from "@/lib/polygon/types";
import { historicalTimeOfDayRvol } from "../rvolTimeOfDay";

function bar(day: number, hour: number, minute: number, volume: number): Bar {
  return {
    time: Math.floor(nyClockToUtcMs(2026, 7, day, hour, minute) / 1000),
    open: 2,
    high: 2.1,
    low: 1.9,
    close: 2,
    volume,
  };
}

describe("historicalTimeOfDayRvol", () => {
  it("compares each candle and cumulative pace with prior sessions at the same time", () => {
    const historical = [1, 2, 3, 6, 7].flatMap((day) => [bar(day, 9, 30, 100), bar(day, 9, 35, 200)]);
    const current = [bar(8, 9, 30, 1_000), bar(8, 9, 35, 2_000)];
    const result = historicalTimeOfDayRvol(current, historical);

    expect(result.baselineSessions).toBe(5);
    expect(result.rvol).toEqual([10, 10]);
    expect(result.cumulativeVolumePace).toEqual([10, 10]);
  });

  it("counts a missing same-time print as zero volume for that historical session", () => {
    const historical = [1, 2, 3, 6, 7].flatMap((day) => day === 7 ? [bar(day, 9, 30, 100)] : [bar(day, 9, 30, 100), bar(day, 9, 35, 200)]);
    const result = historicalTimeOfDayRvol([bar(8, 9, 35, 1_000)], historical);
    expect(result.rvol[0]).toBeCloseTo(6.25);
  });

  it("does not manufacture an RVOL value without enough historical sessions", () => {
    const result = historicalTimeOfDayRvol([bar(8, 9, 30, 1_000)], [bar(7, 9, 30, 100)]);
    expect(result.baselineSessions).toBe(1);
    expect(result.rvol[0]).toBeNaN();
  });

  it("returns finite values when every baseline session is missing a clock slot", () => {
    const historical = [1, 2, 3, 6, 7].map((day) => bar(day, 9, 30, 100));
    const result = historicalTimeOfDayRvol([bar(8, 9, 35, 250)], historical);

    expect(result.rvol).toEqual([250]);
    expect(Number.isFinite(result.rvol[0])).toBe(true);
  });
});
