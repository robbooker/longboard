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

describe("historicalTimeOfDayRvol matches the previous implementation exactly", () => {
  it("gives bit-identical values on random sessions", async () => {
    const { historicalTimeOfDayRvol: legacy } = await import("./legacy/rvolTimeOfDayLegacy");
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let round = 0; round < 8; round++) {
      const historical: Bar[] = [];
      const sessionCount = 3 + Math.floor(random() * 25);
      for (let day = 1; day <= sessionCount; day++) {
        for (let minute = 4 * 60; minute < 20 * 60; minute += 5) {
          if (random() < 0.3) continue; // missing prints
          const volume = random() < 0.05 ? -5 : Math.floor(random() * 50_000) + random();
          historical.push(bar(day, Math.floor(minute / 60), minute % 60, volume));
        }
      }
      historical.sort(() => random() - 0.5); // input order must not matter
      const current: Bar[] = [];
      for (let minute = 4 * 60; minute < 16 * 60; minute += 5) {
        if (random() < 0.2) continue;
        current.push(bar(30, Math.floor(minute / 60), minute % 60, Math.floor(random() * 80_000)));
      }
      expect(historicalTimeOfDayRvol(current, historical)).toEqual(legacy(current, historical));
    }
  }, 60_000);
});
