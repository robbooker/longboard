import type { Bar } from "@/lib/polygon/types";
import {
  crossunder,
  ema,
  isPremarket,
  newDayMarkers,
  sma,
  vwap,
} from "./primitives";

export type RossCameronParams = {
  rvolThreshold: number;
  rvolLookback: number;
  minPrice: number;
  maxPrice: number;
  pullbackDepth: 1 | 2 | 3;
  exitMode: "ema9" | "vwap" | "either";
};

export type RossCameronLatest = {
  rvol: number;
  pmHigh: number;
  abovePMH: boolean;
  status: "ENTRY" | "EXIT" | "SCAN";
};

export type RossCameronResult = {
  ema9: number[];
  vwap: number[];
  rvol: number[];
  pmHigh: number[];
  entries: boolean[];
  exits: boolean[];
  latest: RossCameronLatest;
};

export const DEFAULT_ROSS_CAMERON_PARAMS: RossCameronParams = {
  rvolThreshold: 5.0,
  rvolLookback: 50,
  minPrice: 1.0,
  maxPrice: 20.0,
  pullbackDepth: 1,
  exitMode: "either",
};

const EMPTY_LATEST: RossCameronLatest = {
  rvol: NaN,
  pmHigh: NaN,
  abovePMH: false,
  status: "SCAN",
};

export function rossCameronMomentum(
  bars: Bar[],
  params: Partial<RossCameronParams> = {},
): RossCameronResult {
  const p: RossCameronParams = { ...DEFAULT_ROSS_CAMERON_PARAMS, ...params };

  const n = bars.length;
  if (n === 0) {
    return {
      ema9: [],
      vwap: [],
      rvol: [],
      pmHigh: [],
      entries: [],
      exits: [],
      latest: { ...EMPTY_LATEST },
    };
  }

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const ema9 = ema(closes, 9);
  const vwapArr = vwap(bars);
  const volSma = sma(volumes, p.rvolLookback);
  const rvol = volumes.map((v, i) => {
    const avg = volSma[i];
    return Number.isFinite(avg) && avg > 0 ? v / avg : NaN;
  });

  // Running pre-market high per ET trading day.
  // Resets at each new day; persists into the regular session.
  const dayMarkers = newDayMarkers(bars);
  const pmHigh = new Array(n).fill(0);
  let runningPmh = 0;
  for (let i = 0; i < n; i++) {
    if (dayMarkers[i]) runningPmh = 0;
    if (isPremarket(bars[i].time)) {
      if (bars[i].high > runningPmh) runningPmh = bars[i].high;
    }
    pmHigh[i] = runningPmh;
  }

  const entries: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const c = bars[i].close;
    const prevHigh = bars[i - 1].high;

    const isTradablePrice = c >= p.minPrice && c <= p.maxPrice;
    const highVolume = Number.isFinite(rvol[i]) && rvol[i] >= p.rvolThreshold;
    const uptrend =
      Number.isFinite(vwapArr[i]) && Number.isFinite(ema9[i]) && c > vwapArr[i] && c > ema9[i];
    const pmBreakout = pmHigh[i] > 0 && c > pmHigh[i];
    const isNewHigh = c > prevHigh;

    let wasPullback = i >= p.pullbackDepth;
    for (let k = 1; k <= p.pullbackDepth && wasPullback; k++) {
      const idx = i - k;
      if (idx < 0) {
        wasPullback = false;
        break;
      }
      // A pullback bar: close below open (red bar).
      if (!(bars[idx].close < bars[idx].open)) {
        wasPullback = false;
      }
    }

    if (highVolume && uptrend && pmBreakout && wasPullback && isNewHigh && isTradablePrice) {
      entries[i] = true;
    }
  }

  const closeUnderEma9 = crossunder(closes, ema9);
  const closeUnderVwap = crossunder(closes, vwapArr);
  const exits: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (p.exitMode === "ema9") exits[i] = closeUnderEma9[i];
    else if (p.exitMode === "vwap") exits[i] = closeUnderVwap[i];
    else exits[i] = closeUnderEma9[i] || closeUnderVwap[i];
  }

  const lastIdx = n - 1;
  const latestRvol = rvol[lastIdx];
  const latestPmh = pmHigh[lastIdx];
  const lastClose = bars[lastIdx].close;
  const status: RossCameronLatest["status"] = entries[lastIdx]
    ? "ENTRY"
    : exits[lastIdx]
      ? "EXIT"
      : "SCAN";

  return {
    ema9,
    vwap: vwapArr,
    rvol,
    pmHigh,
    entries,
    exits,
    latest: {
      rvol: Number.isFinite(latestRvol) ? latestRvol : NaN,
      pmHigh: latestPmh,
      abovePMH: latestPmh > 0 && lastClose > latestPmh,
      status,
    },
  };
}
