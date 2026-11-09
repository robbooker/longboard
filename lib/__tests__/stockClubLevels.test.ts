// #386: the Booker Stock Club's levels are the nightly gainers page's numbers. The fixture's expected
// values come from scripts/gainers-daily/run.py itself (lib/__tests__/fixtures/make-stock-club-levels.py).
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/stock-club-levels.json";
import { dailySma200, etDay, levelsAbove, monthlyPivots, type AggBar } from "@/lib/stockClubLevels";

describe("monthly pivots match run.py", () => {
  it("current monthly pivot and missed pivots on the fixture", () => {
    const got = monthlyPivots(fixture.hours as AggBar[], fixture.day);
    expect(got.cmp).toBeCloseTo(fixture.expected.cmp as number, 10);
    expect(got.missed.map((m) => m.month)).toEqual(fixture.expected.missed.map((m) => m.month));
    got.missed.forEach((m, i) => expect(m.price).toBeCloseTo(fixture.expected.missed[i].price, 10));
  });
  it("a pivot touched before the day is not missed; a touch on the day itself doesn't count", () => {
    const at = (day: string, hour: number) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00-04:00`);
    // September: high 12, low 6, close 9 → October's pivot is 9.
    const sept = [{ t: at("2026-09-10", 10), h: 12, l: 6, c: 9 }];
    const octNoTouch = [{ t: at("2026-10-05", 10), h: 5, l: 4, c: 4.5 }];
    const today = [{ t: at("2026-11-06", 10), h: 9.5, l: 8.5, c: 9 }];
    const missed = monthlyPivots([...sept, ...octNoTouch, ...today], "2026-11-06").missed;
    expect(missed).toEqual([{ price: 9, month: "Oct 26" }]);
    const octTouch = [{ t: at("2026-10-05", 10), h: 9.2, l: 4, c: 4.5 }];
    expect(monthlyPivots([...sept, ...octTouch, ...today], "2026-11-06").missed).toEqual([]);
    // October's own pivot is the CMP: (9.2 + 4 + 4.5) / 3.
    expect(monthlyPivots([...sept, ...octTouch], "2026-11-06").cmp).toBeCloseTo(5.9, 10);
  });
  it("months are New York months: 11 PM Eastern on Oct 31 is October", () => {
    expect(etDay(Date.parse("2026-11-01T03:00:00Z"))).toBe("2026-10-31");
  });
});

describe("daily 200 SMA", () => {
  const days = (n: number, close: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => ({ t: Date.parse("2026-01-01T17:00:00Z") + i * 86_400_000, h: 0, l: 0, c: close(i) }));
  it("averages the last 200 closes before the day", () => {
    const bars = days(250, (i) => i);
    const day = etDay(bars[220].t);
    // Closes 20..219 before day 220.
    expect(dailySma200(bars, day)).toBe(119.5);
  });
  it("needs 200 closes", () => expect(dailySma200(days(150, () => 1), "2026-12-31")).toBeNull());
});

describe("levels above price", () => {
  const levels = { cmp: 1.63, missed: [{ price: 4.66, month: "Aug 26" }, { price: 7.37, month: "Jul 26" }, { price: 2, month: "Sep 26" }], sma200: 5.5 };
  it("only the ones above price, nearest first", () => {
    expect(levelsAbove(levels, 3.4).map((l) => [l.kind, l.price])).toEqual([["missed", 4.66], ["sma200", 5.5], ["missed", 7.37]]);
    expect(levelsAbove(levels, 1).map((l) => l.kind)).toEqual(["cmp", "missed", "missed", "sma200", "missed"]);
    expect(levelsAbove({ cmp: null, missed: [], sma200: null }, 1)).toEqual([]);
  });
});
