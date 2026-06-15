import { describe, expect, it } from "vitest";
import { computeGhostPivotFromDailyBars } from "../ghostPivot";
import type { Bar } from "@/lib/polygon/types";

function dailyBar(etDate: string, high: number, low: number, close: number): Bar {
  return {
    time: Math.floor(new Date(`${etDate}T16:00:00Z`).getTime() / 1000),
    open: close,
    high,
    low,
    close,
    volume: 100_000,
  };
}

describe("computeGhostPivotFromDailyBars", () => {
  it("computes next month's developing pivot from the current month high, low, and latest close", () => {
    const pivot = computeGhostPivotFromDailyBars(
      [
        dailyBar("2026-05-30", 110, 100, 104),
        dailyBar("2026-06-01", 12, 10, 11),
        dailyBar("2026-06-10", 18, 9, 17),
        dailyBar("2026-06-15", 15, 11, 14),
      ],
      "2026-06-15",
    );

    expect(pivot).toMatchObject({
      price: (18 + 9 + 14) / 3,
      sourceMonth: "2026-06",
      sourceMonthLabel: "Jun 2026",
      activeMonth: "2026-07",
      activeMonthLabel: "Jul 2026",
      high: 18,
      low: 9,
      close: 14,
      lastCheckedDate: "2026-06-15",
    });
  });

  it("can appear from the first bar of the month", () => {
    const pivot = computeGhostPivotFromDailyBars(
      [dailyBar("2026-07-01", 22, 18, 21)],
      "2026-07-01",
    );

    expect(pivot?.price).toBeCloseTo((22 + 18 + 21) / 3);
    expect(pivot?.activeMonth).toBe("2026-08");
  });

  it("ignores future bars and previous-month bars", () => {
    const pivot = computeGhostPivotFromDailyBars(
      [
        dailyBar("2026-06-30", 100, 1, 50),
        dailyBar("2026-07-01", 20, 15, 18),
        dailyBar("2026-07-02", 40, 12, 30),
      ],
      "2026-07-01",
    );

    expect(pivot?.price).toBeCloseTo((20 + 15 + 18) / 3);
  });

  it("returns null when the current month has no bar through the requested date", () => {
    const pivot = computeGhostPivotFromDailyBars(
      [dailyBar("2026-06-30", 20, 15, 18)],
      "2026-07-01",
    );

    expect(pivot).toBeNull();
  });
});
