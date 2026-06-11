import { describe, expect, it } from "vitest";
import { rossCameronMomentum } from "@/lib/indicators";
import { nyClockToUtcMs } from "@/lib/polygon/client";
import type { Bar } from "@/lib/polygon/types";

function etBar(minute: number, patch: Partial<Bar>): Bar {
  const time = Math.floor(nyClockToUtcMs(2026, 5, 13, 7, minute) / 1000);
  return {
    time,
    open: 1.5,
    high: 1.55,
    low: 1.45,
    close: 1.52,
    volume: 100,
    ...patch,
  };
}

function etDateTimeBar(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  patch: Partial<Bar>,
): Bar {
  return {
    time: Math.floor(nyClockToUtcMs(year, month, day, hour, minute) / 1000),
    open: 1.5,
    high: 1.55,
    low: 1.45,
    close: 1.52,
    volume: 100,
    ...patch,
  };
}

describe("rossCameronMomentum", () => {
  it("can trigger a premarket entry against the prior premarket high", () => {
    const bars: Bar[] = [
      etBar(48, { open: 1.2, high: 1.3, low: 1.18, close: 1.28 }),
      etBar(49, { open: 1.28, high: 1.45, low: 1.27, close: 1.42 }),
      etBar(50, { open: 1.42, high: 1.6, low: 1.4, close: 1.58 }),
      etBar(51, { open: 1.58, high: 1.78, low: 1.56, close: 1.75 }),
      etBar(52, { open: 1.75, high: 2, low: 1.72, close: 1.96 }),
      etBar(53, { open: 1.96, high: 1.98, low: 1.85, close: 1.9 }),
      etBar(54, { open: 1.9, high: 1.95, low: 1.82, close: 1.88 }),
      etBar(55, { open: 1.88, high: 1.93, low: 1.84, close: 1.91 }),
      etBar(56, { open: 1.91, high: 1.96, low: 1.87, close: 1.94 }),
      etBar(57, { open: 1.94, high: 1.99, low: 1.9, close: 1.97 }),
      etBar(58, { open: 1.97, high: 1.98, low: 1.86, close: 1.9 }),
      etBar(59, { open: 1.9, high: 2.2, low: 1.88, close: 2.1, volume: 1000 }),
    ];

    const result = rossCameronMomentum(bars, {
      rvolLookback: 3,
      rvolThreshold: 2,
      maxPrice: 20,
    });

    expect(result.pmHigh.at(-1)).toBe(2.2);
    expect(result.entries.at(-1)).toBe(true);
  });

  it("can trigger a 1h-style entry against the prior two-week high", () => {
    const bars: Bar[] = [];
    for (let day = 1; day <= 10; day++) {
      bars.push(
        etDateTimeBar(2026, 5, day, 10, 0, {
          open: 1.45,
          high: 1.55 + day * 0.05,
          low: 1.4,
          close: 1.5 + day * 0.04,
        }),
      );
    }
    bars.push(
      etDateTimeBar(2026, 5, 13, 9, 0, {
        open: 2.08,
        high: 2.12,
        low: 1.9,
        close: 1.98,
      }),
      etDateTimeBar(2026, 5, 13, 10, 0, {
        open: 2.05,
        high: 2.42,
        low: 2,
        close: 2.35,
        volume: 1000,
      }),
    );

    const result = rossCameronMomentum(bars, {
      breakoutMode: "twoWeekHigh",
      rvolLookback: 3,
      rvolThreshold: 2,
      maxPrice: 20,
    });

    expect(result.breakoutLevel.at(-1)).toBeCloseTo(2.05);
    expect(result.entries.at(-1)).toBe(true);
  });

  it("can trigger a 4h-style entry against the month-to-date high before the current bar", () => {
    const bars: Bar[] = [
      etDateTimeBar(2026, 5, 29, 12, 0, {
        open: 3.8,
        high: 4,
        low: 3.6,
        close: 3.9,
      }),
    ];
    for (let day = 1; day <= 8; day++) {
      bars.push(
        etDateTimeBar(2026, 6, day, 12, 0, {
          open: 2.2 + day * 0.06,
          high: 2.35 + day * 0.08,
          low: 2.1,
          close: 2.25 + day * 0.07,
        }),
      );
    }
    bars.push(
      etDateTimeBar(2026, 6, 11, 8, 0, {
        open: 3.14,
        high: 3.18,
        low: 2.92,
        close: 2.98,
      }),
      etDateTimeBar(2026, 6, 11, 12, 0, {
        open: 3.05,
        high: 3.48,
        low: 3,
        close: 3.36,
        volume: 1000,
      }),
    );

    const result = rossCameronMomentum(bars, {
      breakoutMode: "monthToDateHigh",
      rvolLookback: 3,
      rvolThreshold: 2,
      maxPrice: 20,
    });

    expect(result.breakoutLevel.at(-1)).toBeCloseTo(3.18);
    expect(result.entries.at(-1)).toBe(true);
  });
});
