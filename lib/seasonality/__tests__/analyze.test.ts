import { describe, expect, it } from "vitest";
import {
  analyzeSeasonality,
  type SeasonalityDailyBar,
} from "@/lib/seasonality/analyze";

function bar(date: string, open: number, close: number): SeasonalityDailyBar {
  const [year, month] = date.split("-").map(Number);
  return {
    date,
    year,
    month,
    open,
    close,
    high: Math.max(open, close),
    low: Math.min(open, close),
    volume: 1000,
  };
}

describe("analyzeSeasonality", () => {
  it("builds trailing windows, average paths, and excludes the open month from monthly stats", () => {
    const analysis = analyzeSeasonality("TEST", [
      bar("2024-01-02", 100, 100),
      bar("2024-01-31", 100, 110),
      bar("2024-02-01", 110, 120),
      bar("2024-02-29", 120, 132),
      bar("2025-01-02", 200, 200),
      bar("2025-01-31", 200, 180),
      bar("2025-02-03", 180, 198),
      bar("2025-02-28", 198, 207.9),
      bar("2026-01-02", 300, 300),
      bar("2026-01-30", 300, 330),
      bar("2026-02-02", 330, 360),
      bar("2026-02-05", 360, 390),
    ]);

    const twoYear = analysis.windows.find((window) => window.years === 2);
    expect(twoYear?.from).toBe("2025-01-01");
    expect(twoYear?.observedYears).toEqual([2025, 2026]);
    expect(twoYear?.averagePath[1].averageReturnPct).toBeCloseTo(0);

    const january = twoYear?.monthly.find((month) => month.month === 1);
    expect(january?.observations).toBe(2);
    expect(january?.winRatePct).toBe(50);

    const february = twoYear?.monthly.find((month) => month.month === 2);
    expect(february?.observations).toBe(1);
    expect(february?.averageReturnPct).toBeCloseTo(15.5);
  });
});
