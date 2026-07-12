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
  breakoutMode: "premarketHigh" | "openingRangeHigh" | "twoWeekHigh" | "monthToDateHigh";
  twoWeekLookbackDays: number;
  rvolValues?: number[];
};

export type RossCameronEntryRejectionReason =
  | "RVOL_WARMUP"
  | "RVOL_BELOW_THRESHOLD"
  | "BREAKOUT_LEVEL_UNAVAILABLE"
  | "BELOW_BREAKOUT_LEVEL"
  | "BELOW_VWAP_OR_EMA9"
  | "NO_RED_PULLBACK"
  | "NOT_NEW_HIGH"
  | "OUTSIDE_PRICE_RANGE";

export type RossCameronEntryDiagnostic = {
  tradablePrice: boolean;
  highVolume: boolean;
  uptrend: boolean;
  breakout: boolean;
  pullback: boolean;
  newHigh: boolean;
  conditionsPassed: number;
  rejectionReasons: RossCameronEntryRejectionReason[];
};

export type RossCameronLatest = {
  rvol: number;
  pmHigh: number;
  abovePMH: boolean;
  breakoutLevel: number;
  aboveBreakout: boolean;
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
  breakoutLevel: number[];
  entries: boolean[];
  entryDiagnostics: RossCameronEntryDiagnostic[];
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
  breakoutMode: "premarketHigh",
  twoWeekLookbackDays: 10,
};

/** RVOL lookback that keeps the time-window roughly comparable across
 *  resolutions. Daily uses a conventional 20-session volume baseline. */
export function rvolLookbackForResolution(resolution: "1m" | "5m" | "1h" | "4h" | "1d"): number {
  if (resolution === "1d") return 20;
  return resolution === "5m" ? 20 : 50;
}

const EMPTY_LATEST: RossCameronLatest = {
  rvol: NaN,
  pmHigh: NaN,
  abovePMH: false,
  breakoutLevel: NaN,
  aboveBreakout: false,
  status: "SCAN",
};

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ET_MONTH_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
});

const ET_CLOCK_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

function etDateKey(unixSeconds: number): string {
  return ET_DATE_FMT.format(new Date(unixSeconds * 1000));
}

function etMonthKey(unixSeconds: number): string {
  return ET_MONTH_FMT.format(new Date(unixSeconds * 1000));
}

function etMinutes(unixSeconds: number): number {
  const parts = ET_CLOCK_FMT.formatToParts(new Date(unixSeconds * 1000));
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60
    + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

function twoWeekHighBeforeBar(bars: Bar[], lookbackDays: number): number[] {
  const out = new Array(bars.length).fill(NaN);
  const dayHighs = new Map<string, number>();

  for (let i = 0; i < bars.length; i++) {
    const date = etDateKey(bars[i].time);
    const priorDayHighs = Array.from(dayHighs.entries())
      .filter(([day]) => day !== date)
      .slice(-lookbackDays)
      .map(([, high]) => high);
    out[i] = priorDayHighs.length > 0 ? Math.max(...priorDayHighs) : NaN;
    dayHighs.set(date, Math.max(dayHighs.get(date) ?? -Infinity, bars[i].high));
  }

  return out;
}

function monthToDateHighBeforeBar(bars: Bar[]): number[] {
  const out = new Array(bars.length).fill(NaN);
  let activeMonth = "";
  let runningHigh = -Infinity;

  for (let i = 0; i < bars.length; i++) {
    const month = etMonthKey(bars[i].time);
    if (month !== activeMonth) {
      activeMonth = month;
      runningHigh = -Infinity;
    }
    out[i] = Number.isFinite(runningHigh) ? runningHigh : NaN;
    runningHigh = Math.max(runningHigh, bars[i].high);
  }

  return out;
}

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
      breakoutLevel: [],
      entries: [],
      entryDiagnostics: [],
      exits: [],
      latest: { ...EMPTY_LATEST },
    };
  }

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const vwapArr = vwap(bars);
  const suppliedRvol = p.rvolValues?.length === n ? p.rvolValues : null;
  const volSma = suppliedRvol ? [] : sma(volumes, p.rvolLookback);
  const rvol = suppliedRvol ?? volumes.map((v, i) => {
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
  const twoWeekHigh = twoWeekHighBeforeBar(bars, p.twoWeekLookbackDays);
  const monthToDateHigh = monthToDateHighBeforeBar(bars);
  const openingRangeHigh = new Array(n).fill(0);
  const breakoutLevel = new Array(n).fill(NaN);
  let runningPmh = 0;
  let runningPml = Infinity;
  let runningHod = 0;
  let runningLod = Infinity;
  let runningOpeningRangeHigh = 0;
  for (let i = 0; i < n; i++) {
    if (dayMarkers[i]) {
      runningPmh = 0;
      runningPml = Infinity;
      runningHod = 0;
      runningLod = Infinity;
      runningOpeningRangeHigh = 0;
    }

    pmBreakoutHigh[i] = runningPmh;
    runningHod = Math.max(runningHod, bars[i].high);
    runningLod = Math.min(runningLod, bars[i].low);
    if (isPremarket(bars[i].time)) {
      if (bars[i].high > runningPmh) runningPmh = bars[i].high;
      if (bars[i].low < runningPml) runningPml = bars[i].low;
    }
    const minutes = etMinutes(bars[i].time);
    if (minutes >= 9 * 60 + 30 && minutes < 9 * 60 + 45) {
      runningOpeningRangeHigh = Math.max(runningOpeningRangeHigh, bars[i].high);
    }
    openingRangeHigh[i] = runningOpeningRangeHigh;
    pmHigh[i] = runningPmh;
    pmLow[i] = Number.isFinite(runningPml) ? runningPml : 0;
    highOfDay[i] = runningHod;
    lowOfDay[i] = Number.isFinite(runningLod) ? runningLod : 0;
    if (p.breakoutMode === "twoWeekHigh") {
      breakoutLevel[i] = twoWeekHigh[i];
    } else if (p.breakoutMode === "monthToDateHigh") {
      breakoutLevel[i] = monthToDateHigh[i];
    } else if (p.breakoutMode === "openingRangeHigh") {
      breakoutLevel[i] = minutes >= 9 * 60 + 45 && openingRangeHigh[i] > 0
        ? openingRangeHigh[i]
        : NaN;
    } else {
      breakoutLevel[i] = isPremarket(bars[i].time) ? pmBreakoutHigh[i] : pmHigh[i];
    }
  }

  const entries: boolean[] = new Array(n).fill(false);
  const entryDiagnostics: RossCameronEntryDiagnostic[] = new Array(n);
  entryDiagnostics[0] = {
    tradablePrice: false,
    highVolume: false,
    uptrend: false,
    breakout: false,
    pullback: false,
    newHigh: false,
    conditionsPassed: 0,
    rejectionReasons: ["RVOL_WARMUP", "BREAKOUT_LEVEL_UNAVAILABLE"],
  };
  for (let i = 1; i < n; i++) {
    const c = bars[i].close;
    const prevHigh = bars[i - 1].high;

    const isTradablePrice = c >= p.minPrice && c <= p.maxPrice;
    const highVolume = Number.isFinite(rvol[i]) && rvol[i] >= p.rvolThreshold;
    const uptrend =
      Number.isFinite(vwapArr[i]) && Number.isFinite(ema9[i]) && c > vwapArr[i] && c > ema9[i];
    const activeBreakoutLevel = breakoutLevel[i];
    const breakout = Number.isFinite(activeBreakoutLevel) && activeBreakoutLevel > 0 && c > activeBreakoutLevel;
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

    const rejectionReasons: RossCameronEntryRejectionReason[] = [];
    if (!isTradablePrice) rejectionReasons.push("OUTSIDE_PRICE_RANGE");
    if (!Number.isFinite(rvol[i])) rejectionReasons.push("RVOL_WARMUP");
    else if (!highVolume) rejectionReasons.push("RVOL_BELOW_THRESHOLD");
    if (!uptrend) rejectionReasons.push("BELOW_VWAP_OR_EMA9");
    if (!Number.isFinite(activeBreakoutLevel) || activeBreakoutLevel <= 0) rejectionReasons.push("BREAKOUT_LEVEL_UNAVAILABLE");
    else if (!breakout) rejectionReasons.push("BELOW_BREAKOUT_LEVEL");
    if (!wasPullback) rejectionReasons.push("NO_RED_PULLBACK");
    if (!isNewHigh) rejectionReasons.push("NOT_NEW_HIGH");

    const conditions = [isTradablePrice, highVolume, uptrend, breakout, wasPullback, isNewHigh];
    entryDiagnostics[i] = {
      tradablePrice: isTradablePrice,
      highVolume,
      uptrend,
      breakout,
      pullback: wasPullback,
      newHigh: isNewHigh,
      conditionsPassed: conditions.filter(Boolean).length,
      rejectionReasons,
    };

    if (rejectionReasons.length === 0) {
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
  const latestBreakoutLevel = breakoutLevel[lastIdx];
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
    breakoutLevel,
    entries,
    entryDiagnostics,
    exits,
    latest: {
      rvol: Number.isFinite(latestRvol) ? latestRvol : NaN,
      pmHigh: latestPmh,
      abovePMH: latestPmh > 0 && lastClose > latestPmh,
      breakoutLevel: Number.isFinite(latestBreakoutLevel) ? latestBreakoutLevel : NaN,
      aboveBreakout: Number.isFinite(latestBreakoutLevel) && latestBreakoutLevel > 0 && lastClose > latestBreakoutLevel,
      status,
    },
  };
}
