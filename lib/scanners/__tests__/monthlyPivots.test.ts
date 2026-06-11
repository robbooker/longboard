import { describe, expect, it } from "vitest";
import {
  findAllMissedMonthlyPivotsFromDailyBars,
  findMissedMonthlyPivotsFromDailyBars,
  selectMonthlyPivotTarget,
} from "../monthlyPivots";
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

describe("findMissedMonthlyPivotsFromDailyBars", () => {
  it("finds a prior monthly pivot above price that has not been touched since activation", () => {
    const scan = findMissedMonthlyPivotsFromDailyBars(
      [
        dailyBar("2026-03-04", 20, 12, 16),
        dailyBar("2026-03-18", 30, 15, 30),
        dailyBar("2026-04-02", 19, 16, 18),
        dailyBar("2026-05-12", 21, 17, 19),
        dailyBar("2026-06-10", 22, 18, 20),
      ],
      18.5,
      "2026-06-10",
    );

    expect(scan.countAbovePrice).toBe(1);
    expect(scan.target).toMatchObject({
      price: 24,
      sourceMonth: "2026-03",
      activeMonth: "2026-04",
      activeFromDate: "2026-04-01",
    });
  });

  it("excludes a pivot touched by price in its active month or after", () => {
    const scan = findMissedMonthlyPivotsFromDailyBars(
      [
        dailyBar("2026-03-04", 20, 12, 16),
        dailyBar("2026-03-18", 30, 15, 30),
        dailyBar("2026-04-02", 24.1, 23.9, 18),
        dailyBar("2026-05-12", 21, 17, 19),
        dailyBar("2026-06-10", 22, 18, 20),
      ],
      18.5,
      "2026-06-10",
    );

    expect(scan.countAbovePrice).toBe(0);
    expect(scan.target).toBeNull();
  });

  it("returns the nearest missed pivot above current price when multiple remain open", () => {
    const scan = findMissedMonthlyPivotsFromDailyBars(
      [
        dailyBar("2026-01-20", 26, 17, 17),
        dailyBar("2026-02-20", 30, 21, 21),
        dailyBar("2026-03-20", 17, 14, 16),
        dailyBar("2026-04-20", 18, 15, 17),
        dailyBar("2026-05-20", 18, 15, 17),
        dailyBar("2026-06-10", 18, 15, 16),
      ],
      16,
      "2026-06-10",
    );

    expect(scan.countAbovePrice).toBe(2);
    expect(scan.target?.price).toBe(20);
    expect(scan.pivotsAbovePrice.map((pivot) => pivot.price)).toEqual([20, 24]);
  });

  it("can cache all missed pivots for the day and select a target as price changes", () => {
    const pivots = findAllMissedMonthlyPivotsFromDailyBars(
      [
        dailyBar("2026-01-20", 26, 17, 17),
        dailyBar("2026-02-20", 30, 21, 21),
        dailyBar("2026-03-20", 17, 14, 16),
        dailyBar("2026-04-20", 18, 15, 17),
        dailyBar("2026-05-20", 18, 15, 17),
        dailyBar("2026-06-10", 18, 15, 16),
      ],
      "2026-06-10",
    );

    expect(pivots.map((pivot) => pivot.price)).toEqual([20, 24]);
    expect(selectMonthlyPivotTarget(pivots, 16).target?.price).toBe(20);
    expect(selectMonthlyPivotTarget(pivots, 21).target?.price).toBe(24);
    expect(selectMonthlyPivotTarget(pivots, 25).target).toBeNull();
  });
});
