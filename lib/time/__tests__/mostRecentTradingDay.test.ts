import { describe, expect, it } from "vitest";
import { mostRecentTradingDay } from "../mostRecentTradingDay";

// All test inputs are anchored at 18:00 UTC = 14:00 ET (DST) or 13:00 ET (standard).
// That puts the ET clock comfortably mid-afternoon, well past midnight ET, so the
// ET calendar date matches the UTC date for the dates chosen below.
function utcAt(iso: string): Date {
  return new Date(iso);
}

describe("mostRecentTradingDay", () => {
  it("returns today's ET date for a weekday afternoon", () => {
    // 2026-04-30 is a Thursday.
    expect(mostRecentTradingDay(utcAt("2026-04-30T18:00:00Z"))).toBe("2026-04-30");
  });

  it("walks back to Friday on Saturday", () => {
    // 2026-05-02 is a Saturday → 2026-05-01 (Friday).
    expect(mostRecentTradingDay(utcAt("2026-05-02T18:00:00Z"))).toBe("2026-05-01");
  });

  it("walks back to Friday on Sunday", () => {
    // 2026-05-03 is a Sunday → 2026-05-01 (Friday).
    expect(mostRecentTradingDay(utcAt("2026-05-03T18:00:00Z"))).toBe("2026-05-01");
  });

  it("returns Monday's date on a Monday", () => {
    // 2026-05-04 is a Monday.
    expect(mostRecentTradingDay(utcAt("2026-05-04T18:00:00Z"))).toBe("2026-05-04");
  });

  it("returns Friday's date on a Friday", () => {
    // 2026-05-01 is a Friday.
    expect(mostRecentTradingDay(utcAt("2026-05-01T18:00:00Z"))).toBe("2026-05-01");
  });

  it("uses ET date, not UTC date, around the day boundary", () => {
    // 2026-05-01 03:30 UTC = 2026-04-30 23:30 ET (Thu). UTC date is Fri,
    // but ET calendar still says Thu, so the trading day is 2026-04-30.
    expect(mostRecentTradingDay(utcAt("2026-05-01T03:30:00Z"))).toBe("2026-04-30");
  });
});
