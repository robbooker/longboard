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
});
