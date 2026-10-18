import { describe, expect, it } from "vitest";
import { etClockParts, etDateIsoFromUnixSeconds, etMinutesOfDay } from "../etClock";

// The fast lookups must agree with formatting each timestamp through Intl, which is what
// the indicators and scanners did before.
const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function intlParts(unixSeconds: number) {
  const parts = PARTS.formatToParts(new Date(unixSeconds * 1000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function expectSame(unixSeconds: number) {
  const expected = intlParts(unixSeconds);
  expect(etClockParts(unixSeconds)).toEqual(expected);
  expect(etMinutesOfDay(unixSeconds)).toBe(expected.hour * 60 + expected.minute);
  expect(etDateIsoFromUnixSeconds(unixSeconds)).toBe(DATE.format(new Date(unixSeconds * 1000)));
}

describe("etClock", () => {
  it("matches Intl for every minute across both 2026 DST switches", () => {
    for (const start of [Date.UTC(2026, 2, 7), Date.UTC(2026, 9, 31)]) {
      for (let s = start / 1000; s < start / 1000 + 3 * 86_400; s += 60) {
        expectSame(s);
        expectSame(s + 59);
      }
    }
  });

  it("matches Intl for random timestamps 2000–2040, including odd seconds", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const from = Date.UTC(2000, 0, 1) / 1000;
    const to = Date.UTC(2040, 0, 1) / 1000;
    for (let i = 0; i < 20_000; i++) {
      expectSame(Math.floor(from + random() * (to - from)));
    }
    expectSame(1_792_153_680.5);
  });

  it("throws like Intl on an invalid time", () => {
    expect(() => etMinutesOfDay(Number.NaN)).toThrow(RangeError);
  });
});
