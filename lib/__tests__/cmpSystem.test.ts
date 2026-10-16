import { describe, expect, it } from "vitest";
import {
  aggregateToHourBars,
  CMP_DEFAULTS,
  pineDailyVwap,
  pineEma,
  pineSma,
  runCmpSystem,
  type CmpBar,
  type CmpEvent,
  type CmpSettings,
} from "@/lib/cmpSystem";
import sgrx from "./fixtures/sgrx-2026-10-16.json";

// ── Synthetic bar helpers ────────────────────────────────────────────────────
// 2-minute bars starting 2026-10-16 08:00 ET (12:00 UTC). Small MA lengths keep
// the sequences short: 20-bar "slow SMA", 3-bar "fast EMA" (alpha 0.5).
const T0 = Date.UTC(2026, 9, 16, 12, 0) / 1000;
const FAST: Partial<CmpSettings> = { smaLen: 20, emaLen: 3, mintick: 0.01 };

type OHLC = [number, number, number, number];
function makeBars(rows: OHLC[], start = T0, stepSec = 120): CmpBar[] {
  return rows.map(([open, high, low, close], i) => ({ time: start + i * stepSec, open, high, low, close, volume: 1000 }));
}
const flat = (n: number, px = 1): OHLC[] => Array.from({ length: n }, () => [px, px, px, px] as OHLC);

// Base sequence: 20 flat bars at 1.00, then a spike, a Class B pullback, a
// reclaim of the 9 EMA, a red dip, a trigger, and a run to the high of day.
const BASE: OHLC[] = [
  ...flat(20), //               0-19 SMA/EMA = 1.00
  [1.0, 1.3, 1.0, 1.28], //     20 strong move (high 30% over SMA) → stage 1
  [1.28, 1.29, 1.2, 1.22], //   21 lower high, low not yet near SMA
  [1.22, 1.22, 1.06, 1.08], //  22 low within 7% of SMA (~1.02) but above it → Class B pullback
  [1.08, 1.18, 1.07, 1.17], //  23 close above the EMA → reclaim
  [1.17, 1.2, 1.15, 1.19], //   24 green bounce candle
  [1.19, 1.2, 1.17, 1.18], //   25 red candle dipping to the EMA and holding → DIP (high 1.20)
];
const TRIGGER: OHLC = [1.19, 1.23, 1.185, 1.22]; // 26 trades above 1.20
const RUN_TO_T1: OHLC = [1.22, 1.31, 1.21, 1.3]; // 27 tags the 1.30 HOD

const types = (events: CmpEvent[]) => events.map((e) => e.type);

describe("Pine indicator semantics", () => {
  it("ta.sma is na until len bars, then the rolling mean", () => {
    expect(pineSma([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it("ta.ema seeds with the SMA of the first len closes (or the first close)", () => {
    const sma = pineEma([1, 2, 3, 4], 3);
    expect(sma.slice(0, 2)).toEqual([null, null]);
    expect(sma[2]).toBeCloseTo(2);
    expect(sma[3]).toBeCloseTo(3); // 0.5*4 + 0.5*2
    const first = pineEma([1, 2, 3, 4], 3, "first");
    expect(first[0]).toBe(1);
    expect(first[1]).toBeCloseTo(1.5);
  });

  it("ta.vwap(hlc3) anchors on each new day and is na with no volume", () => {
    const bars: CmpBar[] = [
      { time: 0, open: 1, high: 3, low: 1, close: 2, volume: 0 },
      { time: 1, open: 1, high: 3, low: 1, close: 2, volume: 10 },
      { time: 2, open: 4, high: 4, low: 4, close: 4, volume: 30 },
      { time: 3, open: 9, high: 9, low: 9, close: 9, volume: 5 },
    ];
    expect(pineDailyVwap(bars, [true, false, false, true])).toEqual([null, 2, 3.5, 9]);
  });

  it("CMP is last month's H/L/C pivot and the Ghost is month-to-date H/L + latest close", () => {
    // Two September hours and two October hours (ET), extended hours.
    const h = (iso: string, high: number, low: number, close: number): CmpBar => ({
      time: Date.parse(iso) / 1000,
      open: close,
      high,
      low,
      close,
      volume: 1,
    });
    const hourBars = [
      h("2026-09-30T18:00:00-04:00", 3, 1.5, 2),
      h("2026-09-30T19:00:00-04:00", 2.4, 1.2, 1.8), // Sept: H 3, L 1.2, C 1.8 → CMP 2
      h("2026-10-01T04:00:00-04:00", 1.9, 1.7, 1.75),
      h("2026-10-01T05:00:00-04:00", 1.8, 1.6, 1.7),
    ];
    const chart = makeBars(
      [
        [1.75, 1.9, 1.7, 1.75], // 04:00 hour
        [1.7, 1.8, 1.6, 1.7], //   05:00 hour
        [1.7, 1.72, 1.65, 1.66], // 05:02 same hour
      ],
      Date.parse("2026-10-01T04:00:00-04:00") / 1000,
      3600,
    );
    chart[2].time = chart[1].time + 120;
    const r = runCmpSystem({ bars: chart, hourBars, settings: FAST });
    expect(r.bars[0].cmp).toBeCloseTo(2);
    // first hour of a new month: only the forming hour counts
    expect(r.bars[0].ghost).toBeCloseTo((1.9 + 1.7 + 1.75) / 3);
    // second hour: completed 04:00 hour (H 1.9, L 1.7) + forming 05:00 hour
    expect(r.bars[1].ghost).toBeCloseTo((1.9 + 1.6 + 1.7) / 3);
    expect(r.bars[2].ghost).toBeCloseTo((1.9 + 1.6 + 1.66) / 3);
    // a supplied monthly H/L/C overrides the hour-bar CMP
    const o = runCmpSystem({ bars: chart, hourBars, monthly: [{ year: 2026, month: 9, high: 6, low: 3, close: 3 }] });
    expect(o.bars[0].cmp).toBeCloseTo(4);
  });

  it("aggregates chart bars into clock-hour bars", () => {
    const bars = makeBars([
      [1, 2, 0.5, 1.5],
      [1.5, 3, 1, 2],
    ]);
    expect(aggregateToHourBars(bars)).toEqual([{ time: T0, open: 1, high: 3, low: 0.5, close: 2, volume: 2000 }]);
  });
});

describe("Setup 1 state machine (synthetic bars)", () => {
  it("walks every stage: strong move → pullback (B) → reclaim → dip → buy → T1", () => {
    const r = runCmpSystem({ bars: makeBars([...BASE, TRIGGER, RUN_TO_T1]), settings: FAST });
    expect(r.bars.slice(19).map((b) => b.stage)).toEqual([0, 1, 1, 2, 3, 3, 4, 5, 1]);
    expect(r.bars[22].pullback).toBe(true);
    expect(r.bars[22].grade).toBe("B");
    expect(r.bars[23].reclaim).toBe(true);
    expect(r.bars[25].dip).toBe(true);
    expect(r.bars[25].dipHigh).toBe(1.2);
    const buy = r.bars[26].buy!;
    expect(buy.grade).toBe("B");
    expect(buy.entry).toBeCloseTo(1.21); // max(open 1.19, dipHigh 1.20 + tick)
    expect(buy.stop).toBeCloseTo(1.15 * 0.99); // under the bounce lows, 1% buffer
    expect(buy.t1).toBe(1.3); // high of day before the trigger bar
    expect(buy.stall).toBeCloseTo((r.bars[26].vwap! + 1.3) / 2);
    expect(r.bars[27].targetHit).toBe(true);
    expect(types(r.events)).toEqual(["strongMove", "pullback", "reclaim", "dip", "buy", "target"]);
  });

  it("grades Class A when the pullback touches or breaks the 200 SMA", () => {
    const rows = [...BASE];
    rows[22] = [1.22, 1.22, 1.0, 1.08];
    const r = runCmpSystem({ bars: makeBars([...rows, TRIGGER]), settings: FAST });
    expect(r.bars[22].grade).toBe("A");
    expect(r.bars[26].buy?.grade).toBe("A");
  });

  it("a deeper flush while waiting for the reclaim upgrades B to A", () => {
    const rows: OHLC[] = [...BASE.slice(0, 23), [1.08, 1.09, 1.0, 1.05], [1.05, 1.17, 1.04, 1.16]];
    const r = runCmpSystem({ bars: makeBars(rows), settings: FAST });
    expect(r.bars[22].grade).toBe("B");
    expect(r.bars[23].stage).toBe(2);
    expect(r.bars[23].grade).toBe("A");
    expect(r.bars[24].reclaim).toBe(true);
  });

  it("needs a strong move first: a modest rise never arms", () => {
    const rows: OHLC[] = [...flat(20), [1, 1.08, 1, 1.07], [1.07, 1.07, 1.0, 1.01]];
    const r = runCmpSystem({ bars: makeBars(rows), settings: FAST });
    expect(r.bars.every((b) => b.stage === 0)).toBe(true);
  });

  it("a pullback that stays further than proxPct from the SMA keeps waiting", () => {
    const rows = [...BASE.slice(0, 22), [1.22, 1.22, 1.12, 1.13] as OHLC];
    const r = runCmpSystem({ bars: makeBars(rows), settings: FAST });
    expect(r.bars[22].stage).toBe(1);
    // ... and the same bar qualifies once the threshold is widened
    const wide = runCmpSystem({ bars: makeBars(rows), settings: { ...FAST, proxPct: 12 } });
    expect(wide.bars[22].pullback).toBe(true);
  });

  it("a new high in stage 1 moves the spike instead of counting as a pullback", () => {
    const rows = [...BASE.slice(0, 21), [1.28, 1.35, 1.05, 1.1] as OHLC];
    const r = runCmpSystem({ bars: makeBars(rows), settings: FAST });
    expect(r.bars[21].stage).toBe(1);
    expect(r.bars[21].pullback).toBe(false);
  });

  it("losing the 9 EMA while waiting for the dip goes back to waiting for a reclaim", () => {
    const rows = [...BASE.slice(0, 24), [1.17, 1.17, 1.05, 1.06] as OHLC];
    const r = runCmpSystem({ bars: makeBars(rows), settings: FAST });
    expect(r.bars[24].stage).toBe(2);
    expect(r.events.at(-1)).toMatchObject({ type: "reset", reason: "lostEMA", from: 3 });
  });

  it("a green candle touching the EMA is not a dip; the dip must be red", () => {
    const rows = [...BASE.slice(0, 25), [1.17, 1.2, 1.17, 1.19] as OHLC];
    const r = runCmpSystem({ bars: makeBars(rows), settings: FAST });
    expect(r.bars[25].stage).toBe(3);
    expect(r.bars[25].dip).toBe(false);
  });

  it("a second red dip re-anchors the trigger to its own high", () => {
    const rows: OHLC[] = [...BASE, [1.19, 1.195, 1.17, 1.175], [1.18, 1.2, 1.18, 1.19]];
    const r = runCmpSystem({ bars: makeBars(rows), settings: FAST });
    expect(r.bars[26].stage).toBe(4);
    expect(r.bars[26].dip).toBe(true);
    expect(r.bars[26].dipHigh).toBe(1.195);
    expect(r.events.filter((e) => e.type === "dip").map((e) => (e as { reanchor: boolean }).reanchor)).toEqual([false, true]);
    expect(r.bars[27].buy?.entry).toBeCloseTo(1.205);
  });

  it("times out after maxWaitBars without a trigger", () => {
    const wait: OHLC = [1.18, 1.19, 1.18, 1.19];
    const rows: OHLC[] = [...BASE, wait, wait, wait];
    const r = runCmpSystem({ bars: makeBars(rows), settings: { ...FAST, maxWaitBars: 3 } });
    expect(r.bars.slice(25).map((b) => b.stage)).toEqual([4, 4, 4, 3]);
    expect(r.events.at(-1)).toMatchObject({ type: "reset", reason: "timeout", from: 4 });
  });

  it("does not buy when the T1 (high of day) is not above the fill", () => {
    const rows: OHLC[] = [...BASE, [1.31, 1.33, 1.3, 1.32]];
    const r = runCmpSystem({ bars: makeBars(rows), settings: FAST });
    expect(r.bars[26].buy).toBeNull();
    expect(r.bars[26].stage).toBe(3);
    expect(r.events.at(-1)).toMatchObject({ type: "reset", reason: "tradedThroughNoRoom" });
  });

  describe("CMP gate", () => {
    // September pivot (1.2 + 1.1 + 1.15) / 3 = 1.15, below the 1.21 fill.
    const monthly = [{ year: 2026, month: 9, high: 1.2, low: 1.1, close: 1.15 }];

    it("blocks the buy when the fill is above the CMP, and hides the dip", () => {
      const r = runCmpSystem({ bars: makeBars([...BASE, TRIGGER]), monthly, settings: FAST });
      expect(r.bars[25].cmp).toBeCloseTo(1.15);
      expect(r.bars[25].dip).toBe(true);
      expect(r.bars[25].dipShow).toBe(false);
      expect(r.bars[26].buy).toBeNull();
      expect(r.events.at(-1)).toMatchObject({ type: "reset", reason: "tradedThroughAboveCMP" });
    });

    it("allows it when requireUnderCMP is off", () => {
      const r = runCmpSystem({ bars: makeBars([...BASE, TRIGGER]), monthly, settings: { ...FAST, requireUnderCMP: false } });
      expect(r.bars[26].buy?.cmp).toBeCloseTo(1.15);
    });

    it("allows it when the fill is under the CMP", () => {
      const high = [{ year: 2026, month: 9, high: 2, low: 1.5, close: 1.6 }];
      const r = runCmpSystem({ bars: makeBars([...BASE, TRIGGER]), monthly: high, settings: FAST });
      expect(r.bars[26].buy?.entry).toBeCloseTo(1.21);
      expect(r.bars[25].dipShow).toBe(true);
    });
  });

  describe("stop and target resolution", () => {
    const run = (after: OHLC[], extra: Partial<CmpSettings> = {}) =>
      runCmpSystem({ bars: makeBars([...BASE, TRIGGER, ...after]), settings: { ...FAST, ...extra } });

    it("stop hit", () => {
      const r = run([[1.2, 1.21, 1.13, 1.14]]);
      expect(r.bars[27].stopHit).toBe(true);
      expect(r.bars[27].stage).toBe(1);
      expect(r.events.at(-1)).toMatchObject({ type: "stop" });
    });

    it("when stop and T1 are both inside one bar, the stop wins", () => {
      const r = run([[1.2, 1.35, 1.1, 1.3]]);
      expect(r.bars[27].stopHit).toBe(true);
      expect(r.bars[27].targetHit).toBe(false);
    });

    it("stays in the trade while neither level is touched", () => {
      const r = run([[1.22, 1.25, 1.2, 1.24]]);
      expect(r.bars[27].stage).toBe(5);
    });

    it("after an exit, the next spike reference is the high of day", () => {
      const r = run([RUN_TO_T1, [1.3, 1.3, 1.2, 1.21]]);
      expect(r.bars[27].targetHit).toBe(true);
      // back in stage 1 with spikeHigh = HOD 1.31; next bar is a lower high, still waiting
      expect(r.bars[28].stage).toBe(1);
    });

    it("includeReclaimLow puts the stop under the reclaim candle too", () => {
      const r = run([], { includeReclaimLow: true });
      expect(r.bars[26].buy?.stop).toBeCloseTo(1.07 * 0.99);
    });
  });

  it("starts fresh each trading day (and drops an unresolved state)", () => {
    const bars = makeBars([...BASE.slice(0, 24)]);
    const next = { time: Date.UTC(2026, 9, 17, 8) / 1000, open: 1.05, high: 1.05, low: 1.05, close: 1.05, volume: 1000 };
    const r = runCmpSystem({ bars: [...bars, next], settings: FAST });
    expect(r.bars[23].stage).toBe(3);
    expect(r.bars[24].stage).toBe(0);
    expect(r.events.at(-1)).toMatchObject({ type: "reset", reason: "newDay", from: 3 });
    const keep = runCmpSystem({ bars: [...bars, next], settings: { ...FAST, resetDaily: false } });
    expect(keep.bars[24].stage).toBe(2); // state carried over; the 1.05 close then loses the EMA
  });

  it("does nothing until the slow SMA exists", () => {
    const r = runCmpSystem({ bars: makeBars(BASE.slice(19)), settings: FAST });
    expect(r.bars.every((b) => b.stage === 0 && b.sma === null)).toBe(true);
  });

  it("exports the script's defaults", () => {
    expect(CMP_DEFAULTS).toMatchObject({ smaLen: 200, emaLen: 9, minMovePct: 10, proxPct: 7, dipTolPct: 1, maxWaitBars: 10, stopBufPct: 1 });
  });
});

// ── Real data: SGRX, 16 Oct 2026, 2-minute, extended hours (Polygon) ─────────
// Rob's trade: Class B, bought 2,000 at 0.82, stop 0.71–0.72, T1 = HOD ≈ 0.89–0.90.
describe("SGRX 2026-10-16 (Polygon extended-hours bars)", () => {
  const et = (hhmm: string) => Date.parse(`2026-10-16T${hhmm}:00-04:00`) / 1000;
  const idx = (hhmm: string) => sgrx.bars2m.findIndex((b) => b.time === et(hhmm));
  const run = (s: Partial<CmpSettings> = {}) =>
    runCmpSystem({ bars: sgrx.bars2m, hourBars: sgrx.bars60m, settings: { mintick: 0.0001, ...s } });
  const today = (r: ReturnType<typeof run>) =>
    r.events.filter((e) => e.time >= et("04:00") && !(e.type === "reset" && e.reason === "newDay"));

  it("indicator levels line up with Rob's chart", () => {
    const r = run();
    // 200 SMA ≈ 0.63 on the chart screenshots
    expect(r.bars[idx("09:08")].sma).toBeCloseTo(0.6296, 3);
    // CMP = September (H + L + C) / 3 from extended-hours hourly bars; price is far under it
    expect(r.bars[idx("09:20")].cmp).toBeCloseTo((6.8984 + 1.35 + 1.53) / 3, 4);
    // 9 EMA ≈ 0.794 on the chart at the entry
    expect(r.bars[idx("09:22")].ema).toBeCloseTo(0.795, 2);
  });

  it("with the script's default thresholds the morning setup is NOT detected", () => {
    const r = run();
    const ev = today(r);
    // strong move fires on the 09:00 spike ...
    expect(ev[0]).toMatchObject({ type: "strongMove", time: et("09:00") });
    // ... but the 09:08 washout low (0.684) is 8.6% above the 200 SMA (0.6296), outside the 7% Class B window
    const b = sgrx.bars2m[idx("09:08")];
    expect((b.low / r.bars[idx("09:08")].sma! - 1) * 100).toBeGreaterThan(8.6);
    expect(r.bars[idx("09:08")].stage).toBe(1);
    // so the first pullback is only found at 10:16 and there is no buy
    expect(ev[1]).toMatchObject({ type: "pullback", time: et("10:16"), grade: "B" });
    expect(ev.some((e) => e.type === "buy")).toBe(false);
  });

  it("with proxPct 9 alone, the dip candle is still missed (its low is 3.7% above the 9 EMA)", () => {
    const r = run({ proxPct: 9 });
    expect(r.bars[idx("09:08")].pullback).toBe(true);
    expect(r.bars[idx("09:10")].reclaim).toBe(true);
    const dip = sgrx.bars2m[idx("09:18")];
    expect(dip.close).toBeLessThan(dip.open); // red
    expect((dip.low / r.bars[idx("09:18")].ema! - 1) * 100).toBeGreaterThan(3.6);
    expect(r.bars[idx("09:18")].dip).toBe(false);
    // the port then fires a different, later trade
    const buy = today(r).find((e) => e.type === "buy");
    expect(buy?.time).toBe(et("09:40"));
  });

  it("with proxPct 9 and dipTolPct 4 (reported, not adopted) it reproduces Rob's Class B trade", () => {
    const r = run({ proxPct: 9, dipTolPct: 4 });
    const ev = today(r).map((e) => [e.type, e.time]);
    expect(ev.slice(0, 6)).toEqual([
      ["strongMove", et("09:00")],
      ["pullback", et("09:08")],
      ["reclaim", et("09:10")],
      ["dip", et("09:18")],
      ["buy", et("09:22")],
      ["target", et("09:24")],
    ]);
    const buy = r.bars[idx("09:22")].buy!;
    expect(buy.grade).toBe("B");
    expect(buy.entry).toBeCloseTo(0.8281, 4); // Rob: 0.82
    expect(Math.abs(buy.entry - 0.82)).toBeLessThan(0.01);
    expect(buy.t1).toBe(0.89); // HOD before the trigger = Rob's 0.89–0.90
    // Stop: bounce lows (min 0.74 at 09:12) less 1% = 0.7326. Rob said 0.71–0.72,
    // which sits between this and the reclaim candle's low (0.707).
    expect(buy.stop).toBeCloseTo(0.7326, 4);
    const withReclaim = run({ proxPct: 9, dipTolPct: 4, includeReclaimLow: true }).bars[idx("09:22")].buy!;
    expect(withReclaim.stop).toBeCloseTo(0.707 * 0.99, 4);
    expect(buy.cmp!).toBeGreaterThan(buy.entry);
    expect(buy.ghost!).toBeGreaterThan(buy.t1);
  });
});
