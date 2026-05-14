/**
 * RVOL momentum indicator — pattern lineage from Ross Cameron's
 * small-cap setup, ported from a Pine Script v6 implementation
 * by subscriber E. Phillips. Surfaced in product as "E. Phillips
 * RVOL signals" — do not use the original trader's name in any
 * user-facing string.
 */

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
  ema20: number[];
  vwap: number[];
  rvol: number[];
  pmHigh: number[];
  pmLow: number[];
  highOfDay: number[];
  lowOfDay: number[];
  entries: boolean[];
  exits: boolean[];
  latest: RossCameronLatest;
};

/** Default params tuned for 1-minute bars: 50-bar RVOL lookback ≈ 50
 *  minutes of context, which is the right window for pre-market / open-
 *  drive scanning. Callers fetching at a different resolution should
 *  scale rvolLookback to keep the time-window comparable — for 5m bars
 *  use ~20 (≈100 minutes / 1h40m). The indicator itself has no concept
 *  of resolution; it just runs on whatever Bar[] it receives. */
export const DEFAULT_ROSS_CAMERON_PARAMS: RossCameronParams = {
  rvolThreshold: 5.0,
  rvolLookback: 50,
  minPrice: 1.0,
  maxPrice: 20.0,
  pullbackDepth: 1,
  exitMode: "either",
};

/** RVOL lookback that keeps the time-window roughly comparable across
 *  resolutions. Daily uses a conventional 20-session volume baseline. */
export function rvolLookbackForResolution(resolution: "1m" | "5m" | "1d"): number {
  if (resolution === "1d") return 20;
  return resolution === "5m" ? 20 : 50;
}

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
      ema20: [],
      vwap: [],
      rvol: [],
      pmHigh: [],
      pmLow: [],
      highOfDay: [],
      lowOfDay: [],
      entries: [],
      exits: [],
      latest: { ...EMPTY_LATEST },
    };
  }

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
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
  const pmBreakoutHigh = new Array(n).fill(0);
  const pmLow = new Array(n).fill(0);
  const highOfDay = new Array(n).fill(0);
  const lowOfDay = new Array(n).fill(0);
  let runningPmh = 0;
  let runningPml = Infinity;
  let runningHod = 0;
  let runningLod = Infinity;
  for (let i = 0; i < n; i++) {
    if (dayMarkers[i]) {
      runningPmh = 0;
      runningPml = Infinity;
      runningHod = 0;
      runningLod = Infinity;
    }

    pmBreakoutHigh[i] = runningPmh;
    runningHod = Math.max(runningHod, bars[i].high);
    runningLod = Math.min(runningLod, bars[i].low);
    if (isPremarket(bars[i].time)) {
      if (bars[i].high > runningPmh) runningPmh = bars[i].high;
      if (bars[i].low < runningPml) runningPml = bars[i].low;
    }
    pmHigh[i] = runningPmh;
    pmLow[i] = Number.isFinite(runningPml) ? runningPml : 0;
    highOfDay[i] = runningHod;
    lowOfDay[i] = Number.isFinite(runningLod) ? runningLod : 0;
  }

  const entries: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const c = bars[i].close;
    const prevHigh = bars[i - 1].high;

    const isTradablePrice = c >= p.minPrice && c <= p.maxPrice;
    const highVolume = Number.isFinite(rvol[i]) && rvol[i] >= p.rvolThreshold;
    const uptrend =
      Number.isFinite(vwapArr[i]) && Number.isFinite(ema9[i]) && c > vwapArr[i] && c > ema9[i];
    const breakoutLevel = isPremarket(bars[i].time) ? pmBreakoutHigh[i] : pmHigh[i];
    const pmBreakout = breakoutLevel > 0 && c > breakoutLevel;
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
    ema20,
    vwap: vwapArr,
    rvol,
    pmHigh,
    pmLow,
    highOfDay,
    lowOfDay,
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
