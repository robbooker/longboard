import { describe, expect, it } from "vitest";
import { COUNTRY_STRETCH, DEFAULT_COUNTRY_PROFILE, SCALES, getCountryProfile } from "@/lib/gainerBalloons/config";
import { cleanBars, createMarketData, mapAgility, mapPctChangeToY, mapVolumeScale, mergeFeed, nyEpochMs, type BalloonsFeed, type RawBar, type RawStock } from "@/lib/gainerBalloons/data";
import { formatCompactNumber, formatMarketDay, formatPct, formatPrice, formatRatio } from "@/lib/gainerBalloons/format";
import { centreOutSeats, computeLayout } from "@/lib/gainerBalloons/layout";
import { cardSizeClass, labelBudget, labelTextPx } from "@/components/chat/balloons/scene/quality";

// #528 Gainer Balloons: the data layer the scene and the list both read (getStateAtTime), the
// country table, the layout and the numbers' formats.
const DAY = "2026-11-25";
const OPEN = nyEpochMs(DAY, 9 * 60 + 30);
const MIN = 60_000;
const bar = (minutes: number, open: number, close: number, volume: number, high = Math.max(open, close), low = Math.min(open, close)): RawBar => [OPEN + minutes * MIN, open, high, low, close, volume];
const stock = (extra: Partial<RawStock> = {}): RawStock => ({ ticker: "TEST", country: "U.S.", floatShares: 1_000_000, prevClose: 1, bars: [], ...extra });
const one = (s: RawStock, asOfMs: number | null = null) => createMarketData({ date: DAY, asOfMs, stocks: [s] });
const at = (data: ReturnType<typeof createMarketData>, ms: number) => JSON.parse(JSON.stringify(data.getStateAtTime(ms).stocks[0]));

describe("the trading day", () => {
  it("runs 4:00 AM to 8:00 PM New York, in winter and in summer", () => {
    expect(new Date(nyEpochMs("2026-11-25", 4 * 60)).toISOString()).toBe("2026-11-25T09:00:00.000Z");
    expect(new Date(nyEpochMs("2026-07-15", 4 * 60)).toISOString()).toBe("2026-07-15T08:00:00.000Z");
    const bounds = one(stock()).getTimeBounds();
    expect(bounds.endMs - bounds.startMs).toBe(16 * 3_600_000);
    expect(bounds.regularStartMs).toBe(OPEN);
  });
  it("names the session and clamps a time outside the day", () => {
    const data = one(stock({ bars: [bar(0, 1, 1.1, 1000)] }));
    const { startMs, endMs } = data.getTimeBounds();
    expect(data.getStateAtTime(startMs - 5 * MIN).timeMs).toBe(startMs);
    expect(data.getStateAtTime(endMs + 5 * MIN).progress).toBe(1);
    expect(data.getStateAtTime(OPEN - MIN).session).toBe("pre");
    expect(data.getStateAtTime(OPEN).session).toBe("regular");
    expect(data.getStateAtTime(nyEpochMs(DAY, 16 * 60)).session).toBe("after");
  });
});

describe("getStateAtTime", () => {
  const bars = [bar(0, 1.0, 1.2, 100_000), bar(2, 1.2, 1.6, 200_000), bar(10, 1.6, 1.4, 50_000)];
  const data = one(stock({ bars }));

  it("shows a stock as not yet traded before its first bar", () => {
    const s = at(data, OPEN - MIN);
    expect(s).toMatchObject({ hasTraded: false, cumVolume: 0, pctChange: 0, volumeToFloat: null, burst: 0 });
    expect(s.radius).toBe(SCALES.volume.untradedRadius);
  });
  it("fills volume in evenly and eases price inside a bar", () => {
    const mid = at(data, OPEN + 3 * MIN);
    expect(mid.cumVolume).toBeCloseTo(100_000 + 100_000, 6);
    // Half way through the bar the eased price is half way between the last close and this one.
    expect(mid.price).toBeCloseTo(1.4, 6);
    const quarter = at(data, OPEN + 2.5 * MIN);
    expect(quarter.cumVolume).toBeCloseTo(100_000 + 50_000, 6);
    expect(quarter.price).toBeGreaterThan(1.2);
    expect(quarter.price).toBeLessThan(1.3);
    // The first bar starts from its own open.
    expect(at(data, OPEN).price).toBe(1.0);
  });
  it("holds the last close and volume through a quiet gap", () => {
    const gap = at(data, OPEN + 7 * MIN);
    expect(gap).toMatchObject({ cumVolume: 300_000, price: 1.6, barVolume: 0 });
    expect(gap.pctChange).toBeCloseTo(60, 6);
    expect(gap.volumeToFloat).toBeCloseTo(0.3, 6);
  });
  it("never moves backwards in volume as time goes forwards", () => {
    let last = 0;
    for (let t = OPEN - 4 * MIN; t <= OPEN + 16 * MIN; t += 7_000) {
      const volume = data.getStateAtTime(t).stocks[0].cumVolume;
      expect(volume).toBeGreaterThanOrEqual(last);
      last = volume;
    }
    expect(last).toBe(350_000);
  });
  it("gives exactly the same picture scrubbing backwards as forwards", () => {
    const times = Array.from({ length: 60 }, (_, i) => OPEN - 3 * MIN + i * 17_321);
    const forwards = times.map((t) => at(data, t));
    const backwards = [...times].reverse().map((t) => at(data, t)).reverse();
    expect(backwards).toEqual(forwards);
    // And a jump there and back changes nothing.
    data.getStateAtTime(OPEN + 15 * MIN);
    expect(at(data, times[20])).toEqual(forwards[20]);
  });
  it("keeps the peak, and loses lift when the price falls back after a big run on real volume", () => {
    const run = one(stock({ bars: [bar(0, 1, 2, 400_000), bar(2, 2, 2.2, 400_000, 2.4), bar(4, 2.2, 1.3, 400_000)] }));
    const top = at(run, OPEN + 4 * MIN);
    expect(top.peakPctChange).toBeCloseTo(140, 4);
    expect(top.liftLoss).toBeLessThan(0.15);
    const fallen = at(run, OPEN + 8 * MIN);
    expect(fallen.peakPctChange).toBeCloseTo(140, 4);
    expect(fallen.pctChange).toBeCloseTo(30, 4);
    expect(fallen.liftLoss).toBeGreaterThan(0.3);
    // The balloon never shrinks: volume only grows.
    expect(fallen.radius).toBeGreaterThanOrEqual(top.radius);
  });
  it("shows a bar that was still forming when it was read in full from that moment", () => {
    const forming = [bar(0, 1, 1.1, 100_000), bar(2, 1.1, 1.3, 40_000)];
    const asOf = OPEN + 2 * MIN + 30_000;
    const live = one(stock({ bars: forming }), asOf);
    expect(live.getTimeBounds().lastDataMs).toBe(asOf);
    expect(at(live, asOf)).toMatchObject({ cumVolume: 140_000, price: 1.3 });
    // Replayed, the same half minute still fills in smoothly.
    expect(at(live, OPEN + 2 * MIN + 15_000).cumVolume).toBeCloseTo(120_000, 6);
    // Without a read time the bar is spread over its whole two minutes.
    expect(at(one(stock({ bars: forming })), asOf).cumVolume).toBeCloseTo(110_000, 6);
  });
});

describe("bursts of volume", () => {
  const quiet = Array.from({ length: 10 }, (_, i) => bar(i * 2, 1, 1, 20_000));
  const bars = [...quiet, bar(20, 1, 1.2, 400_000), bar(22, 1.2, 1.2, 20_000)];
  const data = one(stock({ bars }));
  it("marks a bar far above the bars before it, and fades it out", () => {
    expect(at(data, OPEN + 19 * MIN).burst).toBe(0);
    const rising = at(data, OPEN + 20 * MIN + 30_000);
    expect(rising.burst).toBeGreaterThan(0.5);
    expect(rising.burstAge).toBeCloseTo(30_000 / SCALES.burst.decayMs, 6);
    expect(at(data, OPEN + 23 * MIN).burst).toBeLessThan(rising.burst);
    expect(at(data, OPEN + 20 * MIN + SCALES.burst.decayMs + 1).burst).toBe(0);
  });
  it("ignores a busy bar that is small in shares, or not far above the recent ones", () => {
    const small = one(stock({ bars: [...Array.from({ length: 10 }, (_, i) => bar(i * 2, 1, 1, 2_000)), bar(20, 1, 1.1, 30_000)] }));
    expect(at(small, OPEN + 20.5 * MIN).burst).toBe(0);
    const steady = one(stock({ bars: [...Array.from({ length: 10 }, (_, i) => bar(i * 2, 1, 1, 200_000)), bar(20, 1, 1.1, 400_000)] }));
    expect(at(steady, OPEN + 20.5 * MIN).burst).toBe(0);
  });
  it("decides a burst from the day so far, so later volume never takes it back", () => {
    const early = at(data, OPEN + 20.5 * MIN).burst;
    const later = one(stock({ bars: [...bars, ...Array.from({ length: 40 }, (_, i) => bar(30 + i * 2, 1.2, 1.2, 5_000_000))] }));
    expect(at(later, OPEN + 20.5 * MIN).burst).toBe(early);
  });
});

describe("unknown float and missing previous close", () => {
  const bars = [bar(0, 2, 2.5, 3_000_000), bar(2, 2.5, 3, 3_000_000)];
  it("shows no strain for a float that isn't known, and says so", () => {
    for (const floatShares of [null, 0, -5, Number.NaN]) {
      const s = at(one(stock({ floatShares, bars })), OPEN + 6 * MIN);
      expect(s).toMatchObject({ floatKnown: false, floatShares: null, volumeToFloat: null, strain: 0, overInflated: 0 });
      expect(s.agility).toBe(SCALES.agility.unknownAgility);
    }
    expect(one(stock({ floatShares: null })).getStockMetadata()[0].floatKnown).toBe(false);
  });
  it("strains a known float as it turns over", () => {
    const s = at(one(stock({ floatShares: 1_000_000, bars })), OPEN + 6 * MIN);
    expect(s.volumeToFloat).toBeCloseTo(6, 6);
    expect(s.strain).toBeGreaterThan(0.5);
    expect(s.overInflated).toBeGreaterThan(0);
  });
  it("measures change from the day's first trade when there is no previous close", () => {
    for (const prevClose of [null, 0, -1]) {
      const s = at(one(stock({ prevClose, bars })), OPEN + 6 * MIN);
      expect(s.prevClose).toBeNull();
      expect(s.refPrice).toBe(2);
      expect(s.pctChange).toBeCloseTo(50, 6);
    }
    expect(at(one(stock({ prevClose: 1.5, bars })), OPEN + 6 * MIN).pctChange).toBeCloseTo(100, 6);
  });
  it("drops bars that can't be drawn and puts the rest in order", () => {
    const messy = [bar(4, 1, 1.2, 10), ["x"], bar(0, 1, 1.1, 5), [OPEN, 1, 1, 1, Number.NaN, 5], bar(4, 1, 1.3, 20), [OPEN + MIN, 1, 1, 1, 0, 5], bar(2, 1, 1.1, -7)];
    expect(cleanBars(messy).map((b) => [(b[0] - OPEN) / MIN, b[4], b[5]])).toEqual([[0, 1.1, 5], [2, 1.1, 0], [4, 1.3, 20]]);
    expect(cleanBars(null)).toEqual([]);
    expect(at(one(stock({ bars: [] })), OPEN).hasTraded).toBe(false);
  });
});

describe("scales", () => {
  it("clamps size at both ends of the volume scale", () => {
    const v = SCALES.volume;
    expect(mapVolumeScale(0)).toEqual({ norm: 0, baseRadius: v.untradedRadius });
    expect(mapVolumeScale(-10).baseRadius).toBe(v.untradedRadius);
    expect(mapVolumeScale(500)).toEqual({ norm: 0, baseRadius: v.minRadius });
    expect(mapVolumeScale(v.minShares).baseRadius).toBe(v.minRadius);
    expect(mapVolumeScale(v.maxShares)).toEqual({ norm: 1, baseRadius: v.maxBaseRadius });
    expect(mapVolumeScale(5_000_000_000)).toEqual({ norm: 1, baseRadius: v.maxBaseRadius });
    // A log scale: 400K and 80M are both between the ends, in order.
    const a = mapVolumeScale(400_000).baseRadius;
    const b = mapVolumeScale(80_000_000).baseRadius;
    expect(a).toBeGreaterThan(v.minRadius);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(v.maxBaseRadius);
  });
  it("clamps height: never into the ground, never off the top", () => {
    const a = SCALES.altitude;
    expect(mapPctChangeToY(0)).toBe(a.zeroPctY);
    expect(mapPctChangeToY(20)).toBeCloseTo(a.zeroPctY + 20 * a.linearSlopeY, 9);
    expect(mapPctChangeToY(-35)).toBeCloseTo(a.zeroPctY - a.negativeSpanY, 9);
    expect(mapPctChangeToY(-90)).toBe(mapPctChangeToY(-35));
    expect(mapPctChangeToY(100_000)).toBe(a.maxY);
    expect(mapPctChangeToY(270)).toBeLessThan(a.maxY);
    expect(mapPctChangeToY(270)).toBeGreaterThan(mapPctChangeToY(55));
    // A big balloon that is down sits on its own radius, clear of the ground.
    expect(mapPctChangeToY(-35, 2.5)).toBe(2.5 + a.minGroundClearance);
  });
  it("makes low floats lighter, within limits", () => {
    expect(mapAgility(SCALES.agility.minFloat / 10)).toBe(1);
    expect(mapAgility(SCALES.agility.maxFloat * 10)).toBe(0);
    expect(mapAgility(2_000_000)).toBeGreaterThan(mapAgility(50_000_000));
    expect(mapAgility(null)).toBe(SCALES.agility.unknownAgility);
  });
  it("lets a Chinese company's balloon stretch further than a U.S. one's on the same volume and float", () => {
    const bars = [bar(0, 1, 2, 10_000_000)];
    const us = at(one(stock({ country: "U.S.", bars })), OPEN + 4 * MIN);
    const china = at(one(stock({ country: "China", bars })), OPEN + 4 * MIN);
    expect(us.baseRadius).toBe(china.baseRadius);
    expect(us.radius).toBe(us.baseRadius);
    expect(china.radius).toBeGreaterThan(us.radius * 1.3);
    expect(china.elongation).toBeGreaterThan(us.elongation);
  });
});

describe("country table", () => {
  it("reads China, Hong Kong and \"China Hong Kong\" as the highest stretch", () => {
    for (const name of ["China", "Hong Kong", "China Hong Kong", "china hong kong", "China (Hong Kong)", "Hong Kong SAR", "People's Republic of China", "Macau"]) {
      expect(getCountryProfile(name), name).toMatchObject({ tier: "china", stretchCap: 1.65 });
    }
    expect(getCountryProfile("China Hong Kong")).toBe(COUNTRY_STRETCH["china hong kong"]);
  });
  it("reads every spelling of the United States as the least", () => {
    for (const name of ["U.S.", "US", "USA", "United States", "united states of america"]) expect(getCountryProfile(name), name).toMatchObject({ tier: "us", stretchCap: 1 });
  });
  it("places other homes between them, and anything else (or nothing) in the middle", () => {
    expect(getCountryProfile("Singapore")).toMatchObject({ tier: "non_us", stretchCap: 1.34 });
    expect(getCountryProfile("Israel").stretchCap).toBe(1.26);
    expect(getCountryProfile("United Kingdom").stretchCap).toBe(1.14);
    for (const name of ["Cayman Islands", "Australia", "", "  ", null, undefined]) expect(getCountryProfile(name)).toBe(DEFAULT_COUNTRY_PROFILE);
    // "Indochina" is not China.
    expect(getCountryProfile("Indochina")).toBe(DEFAULT_COUNTRY_PROFILE);
    const caps = Object.values(COUNTRY_STRETCH).map((p) => p.stretchCap);
    expect(Math.max(...caps)).toBe(COUNTRY_STRETCH.china.stretchCap);
    expect(Math.min(...caps)).toBe(COUNTRY_STRETCH.us.stretchCap);
  });
});

describe("layout", () => {
  const many = Array.from({ length: 60 }, (_, i) => stock({ ticker: `T${String(i).padStart(2, "0")}`, country: ["China", "Singapore", "U.S."][i % 3], floatShares: i % 4 ? 2_000_000 : null, bars: [bar(0, 1, 1.5, 50_000 * (i + 1))] }));
  const metadata = createMarketData({ date: DAY, stocks: many }).getStockMetadata();
  it("moors every stock, in its own wing, with room around it", () => {
    const anchors = computeLayout(metadata);
    expect(anchors.filter(Boolean)).toHaveLength(60);
    anchors.forEach((a, i) => expect(a.id).toBe(i));
    expect(anchors.filter((a) => a.sector === "china").every((a) => a.x < 0)).toBe(true);
    expect(anchors.filter((a) => a.sector === "us").every((a) => a.x > 0)).toBe(true);
    let closest = Infinity;
    for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) closest = Math.min(closest, Math.hypot(anchors[i].x - anchors[j].x, anchors[i].z - anchors[j].z));
    expect(closest).toBeGreaterThan(4.5);
    // Everything stays on the ground disc (65 across the radius).
    expect(Math.max(...anchors.map((a) => Math.hypot(a.x, a.z)))).toBeLessThan(60);
  });
  it("gives the same field for the same stocks", () => {
    expect(computeLayout(metadata)).toEqual(computeLayout(metadata));
  });
  it("seats the biggest story in the middle of its row", () => {
    expect(centreOutSeats(5)).toEqual([2, 1, 3, 0, 4]);
    expect(centreOutSeats(4)).toEqual([1, 2, 0, 3]);
    expect(centreOutSeats(1)).toEqual([0]);
    const us = metadata.filter((m) => m.tier === "us").sort((a, b) => b.dayVolume - a.dayVolume);
    const anchors = computeLayout(metadata);
    const inner = us.slice(0, 3).map((m) => Math.hypot(anchors[m.id].x, anchors[m.id].z));
    const outer = us.slice(-3).map((m) => Math.hypot(anchors[m.id].x, anchors[m.id].z));
    expect(Math.max(...inner)).toBeLessThan(Math.min(...outer));
  });
  it("lays out an empty day and a single stock", () => {
    expect(computeLayout([])).toEqual([]);
    expect(computeLayout(createMarketData({ date: DAY, stocks: [stock()] }).getStockMetadata())).toHaveLength(1);
  });
});

describe("the page's feed", () => {
  const feed = (extra: Partial<BalloonsFeed>): BalloonsFeed => ({ day: DAY, today: DAY, now: OPEN, barMinutes: 2, since: null, stocks: [], ...extra });
  const held = feed({ stocks: [{ ...stock({ ticker: "AAA", bars: [bar(0, 1, 1.1, 10), bar(2, 1.1, 1.2, 10), bar(4, 1.2, 1.3, 5)] }), earlier: 0 }] });
  it("adds the newest bars to the day it holds", () => {
    const next = feed({ since: OPEN + 4 * MIN, stocks: [{ ...stock({ ticker: "AAA", bars: [bar(4, 1.2, 1.35, 9), bar(6, 1.35, 1.4, 3)] }), earlier: 2 }] });
    const merged = mergeFeed(held, next)!;
    expect(merged.since).toBeNull();
    expect(merged.stocks[0].bars.map((b) => [(b[0] - OPEN) / MIN, b[5]])).toEqual([[0, 10], [2, 10], [4, 9], [6, 3]]);
  });
  it("asks for the whole day when the newest bars don't fit: a new stock, a new day, a different count, or nothing held", () => {
    const since = OPEN + 4 * MIN;
    expect(mergeFeed(held, feed({ since, stocks: [{ ...stock({ ticker: "NEW" }), earlier: 3 }] }))).toBeNull();
    expect(mergeFeed(held, feed({ since, day: "2026-11-26", stocks: [] }))).toBeNull();
    expect(mergeFeed(held, feed({ since, stocks: [{ ...stock({ ticker: "AAA" }), earlier: 5 }] }))).toBeNull();
    expect(mergeFeed(null, feed({ since, stocks: [] }))).toBeNull();
    // A whole day always replaces what is held; a stock that left the list goes with it.
    const whole = feed({ stocks: [] });
    expect(mergeFeed(held, whole)).toBe(whole);
  });
});

describe("formats and card sizes", () => {
  it("shows a dash for a missing number", () => {
    for (const format of [formatCompactNumber, formatPrice, formatPct, formatRatio]) for (const value of [null, undefined, Number.NaN, Infinity]) expect(format(value)).toBe("—");
    expect([formatCompactNumber(949_200), formatCompactNumber(82_902_875), formatPrice(0.4512), formatPrice(12.5), formatPct(45.04), formatPct(-3.21), formatRatio(23.04), formatRatio(0.5)]).toEqual([
      "949.2K", "82.90M", "$0.4512", "$12.50", "+45.0%", "-3.2%", "23.0×", "0.50×",
    ]);
    expect(formatMarketDay("2026-11-25")).toBe("Wed, Nov 25");
  });
  it("gives a small card fewer labels and no scrubber class", () => {
    expect(cardSizeClass(950, 900)).toBe("large");
    expect(cardSizeClass(455, 330)).toBe("medium");
    expect(cardSizeClass(340, 500)).toBe("small");
    expect(cardSizeClass(500, 260)).toBe("small");
    expect(labelBudget(1600, 900, false)).toBe(60);
    expect(labelBudget(635, 470, true)).toBe(14);
    expect(labelBudget(455, 330, true)).toBe(7);
    expect(labelBudget(200, 150, true)).toBe(5);
    expect(labelTextPx("small", 300)).toBeLessThan(labelTextPx("full", 1400));
  });
});
