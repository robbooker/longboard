import { describe, expect, it } from "vitest";
import {
  crossover,
  crossunder,
  ema,
  isPremarket,
  isRegularSession,
  newDayMarkers,
  sma,
  vwap,
} from "../primitives";
import type { Bar } from "@/lib/polygon/types";

// 2026-04-30, 04:30 ET = 08:30 UTC = 1777883400 (DST in effect, ET = UTC-4)
// Sanity check: new Date(1777883400 * 1000).toISOString() === "2026-04-30T08:30:00.000Z"
const APR30_0430_ET = 1777883400;
const ONE_MIN = 60;

function makeBar(t: number, c = 10, v = 100, o = c, h = c, l = c): Bar {
  return { time: t, open: o, high: h, low: l, close: c, volume: v };
}

describe("ema", () => {
  it("warms up over `period` bars then tracks input", () => {
    const result = ema([1, 2, 3, 4, 5], 3);
    expect(result.slice(0, 2).every((v) => Number.isNaN(v))).toBe(true);
    expect(result[2]).toBe(2);
    expect(result[3]).toBeCloseTo(3, 10);
    expect(result[4]).toBeCloseTo(4, 10);
  });

  it("returns all-NaN when input shorter than period", () => {
    expect(ema([1, 2], 5).every((v) => Number.isNaN(v))).toBe(true);
  });

  it("on a flat input, ema equals that constant past warmup", () => {
    const result = ema([7, 7, 7, 7, 7, 7, 7, 7, 7, 7], 5);
    for (let i = 4; i < result.length; i++) expect(result[i]).toBeCloseTo(7, 10);
  });

  it("does not mutate input", () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];
    ema(input, 3);
    expect(input).toEqual(snapshot);
  });
});

describe("sma", () => {
  it("matches the manual mean past warmup", () => {
    const result = sma([2, 4, 6, 8, 10], 3);
    expect(Number.isNaN(result[0])).toBe(true);
    expect(Number.isNaN(result[1])).toBe(true);
    expect(result[2]).toBeCloseTo(4, 10);
    expect(result[3]).toBeCloseTo(6, 10);
    expect(result[4]).toBeCloseTo(8, 10);
  });
});

describe("crossunder", () => {
  it("fires when a crosses strictly below b", () => {
    // a=[10,9,8,7], b=[8,8,8,8]. Cross fires when a[prev] >= b[prev] AND a[i] < b[i].
    // i=2: a[1]=9>=8 ✓, a[2]=8<8 ✗ → false. i=3: a[2]=8>=8 ✓, a[3]=7<8 ✓ → true.
    const a = [10, 9, 8, 7];
    const b = [8, 8, 8, 8];
    const result = crossunder(a, b);
    expect(result[0]).toBe(false);
    expect(result[1]).toBe(false);
    expect(result[2]).toBe(false);
    expect(result[3]).toBe(true);
  });

  it("does not fire on equality without a strict cross", () => {
    expect(crossunder([5, 5, 5], [5, 5, 5])[1]).toBe(false);
  });

  it("ignores NaN warmup values", () => {
    const a = [NaN, NaN, 10, 5];
    const b = [NaN, NaN, 7, 7];
    expect(crossunder(a, b)[3]).toBe(true);
    expect(crossunder(a, b)[2]).toBe(false);
  });
});

describe("crossover", () => {
  it("fires when a crosses above b", () => {
    const a = [1, 2, 3, 4];
    const b = [3, 3, 3, 3];
    const result = crossover(a, b);
    expect(result[3]).toBe(true);
    expect(result[2]).toBe(false);
  });
});

describe("vwap", () => {
  it("equals the typical price on a single bar", () => {
    const bars: Bar[] = [{ time: APR30_0430_ET, open: 10, high: 12, low: 8, close: 11, volume: 1000 }];
    const result = vwap(bars);
    expect(result[0]).toBeCloseTo((12 + 8 + 11) / 3, 10);
  });

  it("is a volume-weighted average across bars within the same day", () => {
    const bars: Bar[] = [
      { time: APR30_0430_ET, open: 10, high: 10, low: 10, close: 10, volume: 100 },
      { time: APR30_0430_ET + ONE_MIN, open: 20, high: 20, low: 20, close: 20, volume: 300 },
    ];
    const result = vwap(bars);
    expect(result[0]).toBeCloseTo(10, 10);
    // Cumulative: (10*100 + 20*300) / (100 + 300) = 7000 / 400 = 17.5
    expect(result[1]).toBeCloseTo(17.5, 10);
  });

  it("resets at new ET trading-day boundary", () => {
    const day1 = APR30_0430_ET;
    const day2 = APR30_0430_ET + 24 * 60 * 60;
    const bars: Bar[] = [
      { time: day1, open: 10, high: 10, low: 10, close: 10, volume: 100 },
      { time: day2, open: 50, high: 50, low: 50, close: 50, volume: 100 },
    ];
    const result = vwap(bars);
    expect(result[0]).toBeCloseTo(10, 10);
    // Day 2 starts fresh — should equal day 2's typical price, not blended.
    expect(result[1]).toBeCloseTo(50, 10);
  });
});

describe("session filters", () => {
  it("isPremarket: 04:30 ET on 2026-04-30 is true", () => {
    expect(isPremarket(APR30_0430_ET)).toBe(true);
  });

  it("isPremarket: 09:30 ET (regular open) is false", () => {
    const open = APR30_0430_ET + 5 * 60 * 60; // 04:30 + 5h = 09:30 ET
    expect(isPremarket(open)).toBe(false);
  });

  it("isRegularSession: 09:30 ET is true, 16:00 ET is false", () => {
    const open = APR30_0430_ET + 5 * 60 * 60;
    const close = APR30_0430_ET + (11 * 60 + 30) * 60; // 04:30 + 11h30m = 16:00 ET
    expect(isRegularSession(open)).toBe(true);
    expect(isRegularSession(close)).toBe(false);
  });
});

describe("newDayMarkers", () => {
  it("marks index 0 and the first bar of each new ET date", () => {
    const day1 = APR30_0430_ET;
    const bars: Bar[] = [
      makeBar(day1),
      makeBar(day1 + ONE_MIN),
      makeBar(day1 + 24 * 60 * 60),
      makeBar(day1 + 24 * 60 * 60 + ONE_MIN),
      makeBar(day1 + 48 * 60 * 60),
    ];
    expect(newDayMarkers(bars)).toEqual([true, false, true, false, true]);
  });

  it("returns empty for empty input", () => {
    expect(newDayMarkers([])).toEqual([]);
  });
});
