import { describe, expect, it } from "vitest";
import { runCmpSystem, type CmpBar, type CmpSettings } from "@/lib/cmpSystem";
import {
  closedBars,
  cmpScannerRow,
  distancePct,
  firstIndexOfLastDay,
  sortCmpScannerRows,
  type CmpScannerRow,
} from "@/lib/scanners/cmpScannerRows";

// Same synthetic 2m sequence as lib/__tests__/cmpSystem.test.ts: 20-bar SMA,
// 3-bar EMA, starting 2026-10-16 08:00 ET.
const T0 = Date.UTC(2026, 9, 16, 12, 0) / 1000;
const FAST: Partial<CmpSettings> = { smaLen: 20, emaLen: 3, mintick: 0.01 };
type OHLC = [number, number, number, number];
const makeBars = (rows: OHLC[], start = T0): CmpBar[] =>
  rows.map(([open, high, low, close], i) => ({ time: start + i * 120, open, high, low, close, volume: 1000 }));
const flat = (n: number, px = 1): OHLC[] => Array.from({ length: n }, () => [px, px, px, px] as OHLC);

const BASE: OHLC[] = [
  ...flat(20),
  [1.0, 1.3, 1.0, 1.28], //     20 strong move
  [1.28, 1.29, 1.2, 1.22], //   21
  [1.22, 1.22, 1.06, 1.08], //  22 Class B pullback
  [1.08, 1.18, 1.07, 1.17], //  23 reclaim
  [1.17, 1.2, 1.15, 1.19], //   24
  [1.19, 1.2, 1.17, 1.18], //   25 red dip (high 1.20)
];
const TRIGGER: OHLC = [1.19, 1.23, 1.185, 1.22];
const RUN_TO_T1: OHLC = [1.22, 1.31, 1.21, 1.3];
const STOP_OUT: OHLC = [1.2, 1.2, 1.1, 1.12];

function rowFor(rows: OHLC[], start = T0) {
  const bars = makeBars(rows, start);
  const row = cmpScannerRow({ ticker: "TEST", changePct: 42 }, bars, runCmpSystem({ bars, settings: FAST }));
  expect(row).not.toBeNull();
  return row!;
}

describe("cmpScannerRow", () => {
  it("is waiting before a strong move", () => {
    const row = rowFor(flat(22));
    expect(row.stage).toBe("waiting");
    expect(row.detail).toBe("Waiting for strong move");
    expect(row.grade).toBeNull();
    expect(row.entry).toBeNull();
    expect(row.price).toBe(1);
  });

  it("shows the pullback with its grade, then the reclaim", () => {
    const pullback = rowFor(BASE.slice(0, 23));
    expect(pullback.stage).toBe("pullback");
    expect(pullback.grade).toBe("B");
    expect(pullback.stageTime).toBe(T0 + 22 * 120);
    expect(pullback.t1).toBeCloseTo(1.3);

    const reclaim = rowFor(BASE.slice(0, 24));
    expect(reclaim.stage).toBe("reclaim");
    expect(reclaim.stageTime).toBe(T0 + 23 * 120);
    expect(reclaim.entry).toBeNull();
  });

  it("arms on the dip: trigger = dip high + tick, projected stop under the bounce lows", () => {
    const row = rowFor(BASE);
    expect(row.stage).toBe("dip");
    expect(row.entry).toBeCloseTo(1.21);
    expect(row.stop).toBeCloseTo(1.15 * 0.99);
    expect(row.t1).toBeCloseTo(1.3);
    expect(row.stageTime).toBe(T0 + 25 * 120);
  });

  it("the projected stop matches the stop the system uses on the BUY", () => {
    const armed = rowFor(BASE);
    const row = rowFor([...BASE, TRIGGER]);
    expect(row.stage).toBe("buy");
    expect(row.entry).toBeCloseTo(1.21);
    expect(row.stop).toBeCloseTo(armed.stop!);
    expect(row.t1).toBeCloseTo(1.3);
    expect(row.stageTime).toBe(T0 + 26 * 120);
  });

  it("reports T1 hit and stopped trades with the trade's levels", () => {
    const won = rowFor([...BASE, TRIGGER, RUN_TO_T1]);
    expect(won.stage).toBe("t1Hit");
    expect(won.entry).toBeCloseTo(1.21);
    expect(won.t1).toBeCloseTo(1.3);
    expect(won.stageTime).toBe(T0 + 27 * 120);

    const lost = rowFor([...BASE, TRIGGER, STOP_OUT]);
    expect(lost.stage).toBe("stopped");
    expect(lost.stop).toBeCloseTo(1.15 * 0.99);
  });

  it("ignores trades from earlier days", () => {
    const yesterday = makeBars([...BASE, TRIGGER, RUN_TO_T1], T0 - 86_400);
    const today = makeBars(flat(3, 1.3));
    const bars = [...yesterday, ...today];
    const row = cmpScannerRow({ ticker: "TEST", changePct: 1 }, bars, runCmpSystem({ bars, settings: FAST }));
    expect(row?.stage).toBe("waiting");
    expect(row?.entry).toBeNull();
  });

  it("computes distance to CMP and Ghost from the last close", () => {
    const row = rowFor(BASE);
    expect(row.ghost).not.toBeNull();
    expect(row.ghostDistPct).toBeCloseTo(((1.18 - row.ghost!) / row.ghost!) * 100);
    expect(row.cmp).toBeNull(); // no prior month in the input
    expect(row.cmpDistPct).toBeNull();
  });

  it("returns null without bars", () => {
    expect(cmpScannerRow({ ticker: "X", changePct: 0 }, [], runCmpSystem({ bars: [] }))).toBeNull();
  });
});

describe("helpers", () => {
  it("distancePct", () => {
    expect(distancePct(110, 100)).toBeCloseTo(10);
    expect(distancePct(90, 100)).toBeCloseTo(-10);
    expect(distancePct(1, null)).toBeNull();
    expect(distancePct(1, 0)).toBeNull();
  });

  it("closedBars drops a still-forming last bar", () => {
    const bars = makeBars(flat(3));
    const lastOpen = bars[2].time;
    expect(closedBars(bars, 120, lastOpen + 60)).toHaveLength(2);
    expect(closedBars(bars, 120, lastOpen + 120)).toHaveLength(3);
    expect(closedBars([], 120, 0)).toEqual([]);
  });

  it("firstIndexOfLastDay uses the New York date", () => {
    // 2026-10-16 23:58 ET is still the 16th even though it is the 17th in UTC.
    const late = Date.UTC(2026, 9, 17, 3, 58) / 1000;
    const bars = [{ time: late - 86_400 }, { time: late - 60 }, { time: late }, { time: late + 7_200 }];
    expect(firstIndexOfLastDay(bars, "America/New_York")).toBe(3);
    expect(firstIndexOfLastDay(bars.slice(0, 3), "America/New_York")).toBe(1);
  });

  it("sorts BUY and armed setups first, then by % change", () => {
    const r = (ticker: string, stage: CmpScannerRow["stage"], changePct: number) =>
      ({ ticker, stage, changePct }) as CmpScannerRow;
    const sorted = sortCmpScannerRows([
      r("W", "waiting", 90),
      r("S", "stopped", 10),
      r("D", "dip", 20),
      r("B", "buy", 5),
      r("D2", "dip", 30),
    ]);
    expect(sorted.map((x) => x.ticker)).toEqual(["B", "D2", "D", "S", "W"]);
  });
});
