/**
 * Longboard CMP system — Setup 1 ("Trade Under the Current Monthly Pivot",
 * 9 EMA dip → bounce long).
 *
 * A bar-by-bar TypeScript port of Rob Booker's Pine v6 indicator. By default
 * it follows `skills/cmp-system/reference/lb-cmp-bounce-v2.pine` (version 2:
 * EOD exit on the daily reset, spike-and-flush pullbacks, bounce lows reset on
 * re-arm, stop from lows known before the trigger bar, stop/T1 checked on the
 * entry bar, T1 = today's HOD, optional max-minutes wait, "setup under CMP").
 * `settings.version = 1` gives exact parity with Rob's original
 * `lb-cmp-bounce.pine`.
 * The rules in plain language live in `skills/cmp-system/SKILL.md`; the
 * machine-readable state machine and defaults in `skills/cmp-system/rules.yaml`.
 *
 * Pure and dependency-free: no network, no DB. Feed it extended-hours bars.
 *
 * Pine semantics reproduced here (see "Parity notes" at the bottom):
 *  - ta.sma(close, 200): na until 200 bars exist, then the plain rolling mean.
 *  - ta.ema(close, 9): na for the first 8 bars, seeded with the SMA of the
 *    first 9 closes, then alpha = 2 / (len + 1). (Configurable: `emaSeed`.)
 *  - ta.vwap(hlc3): cumulative (hlc3 * volume) / cumulative volume, reset on
 *    the first bar of each trading day; na while cumulative volume is 0.
 *  - timeframe.change("D") / ("M") / ("60"): calendar day / month / clock hour
 *    of the bar's open time in the exchange time zone (America/New_York);
 *    true on the very first bar.
 *  - `var` state persists across bars; the state machine runs once per closed
 *    bar in the same if/else-if order as the script.
 *  - Intrabar trigger fill = max(open, dipHigh + mintick).
 *  - Monthly pivots: request.security(extended ticker, "60", f_monthly(),
 *    lookahead_on) — each chart bar reads the 60-minute bar that contains it,
 *    and the script only returns values that are known at that hour's open
 *    (prior-month pivot, month-to-date H/L of *completed* hours).
 */

export type CmpBar = {
  /** Bar open time, unix seconds (same convention as lib/polygon/types Bar). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CmpSettings = {
  smaLen: number;
  emaLen: number;
  requireUnderCMP: boolean;
  /** Strong move: high must get at least this % above the 200 SMA. */
  minMovePct: number;
  /** Class B pullback: low must come within this % of the 200 SMA. */
  proxPct: number;
  /** 9 EMA touch tolerance (%). */
  dipTolPct: number;
  /** Bars to wait for the trigger after a dip. */
  maxWaitBars: number;
  /** v2 only: also time out after this many minutes since the dip (0 = off). */
  maxWaitMins: number;
  /** Start fresh each trading day. */
  resetDaily: boolean;
  /** Stop buffer below the bounce lows (%). */
  stopBufPct: number;
  /** Also put the stop under the reclaim candle. */
  includeReclaimLow: boolean;
  /** syminfo.mintick. TradingView uses 0.0001 for most sub-$1 US stocks. */
  mintick: number;
  /** Exchange time zone used for day / month / hour boundaries. */
  timeZone: string;
  /**
   * How ta.ema is seeded. "sma" (default) = na for the first len-1 bars, then
   * SMA seed (TradingView built-in behaviour). "first" = seed with the first
   * close (the pseudo-code shown in the Pine reference manual).
   */
  emaSeed: "sma" | "first";
  /**
   * 2 (default) = lb-cmp-bounce-v2.pine behaviour; 1 = exact parity with
   * Rob's original lb-cmp-bounce.pine.
   */
  version: 1 | 2;
};

/** The script's input defaults. These are tunable defaults, not rules. */
export const CMP_DEFAULTS: CmpSettings = {
  smaLen: 200,
  emaLen: 9,
  requireUnderCMP: true,
  minMovePct: 10,
  proxPct: 7,
  dipTolPct: 1,
  maxWaitBars: 10,
  maxWaitMins: 0,
  resetDaily: true,
  stopBufPct: 1,
  includeReclaimLow: false,
  mintick: 0.01,
  timeZone: "America/New_York",
  emaSeed: "sma",
  version: 2,
};

/**
 * 0 waiting for strong move · 1 waiting for pullback · 2 waiting for 9 EMA
 * reclaim · 3 waiting for red dip · 4 armed, waiting for trigger · 5 in trade
 */
export type CmpStage = 0 | 1 | 2 | 3 | 4 | 5;

export const CMP_STAGE_LABELS: Record<CmpStage, string> = {
  0: "Waiting for strong move",
  1: "Waiting for pullback to 200 SMA",
  2: "Waiting for 9 EMA reclaim",
  3: "Waiting for red dip to 9 EMA",
  4: "Armed: waiting for break of the dip candle's high",
  5: "In trade",
};

export type CmpGrade = "A" | "B";

/** One completed month (extended hours), for supplying CMP directly. */
export type MonthlyHLC = { year: number; month: number; high: number; low: number; close: number };

export type CmpBuy = {
  entry: number;
  stop: number;
  /** T1 = high of day before the trigger bar (v1: or the spike high if higher). */
  t1: number;
  /** Stall zone = midpoint of VWAP and HOD on the trigger bar. */
  stall: number | null;
  ghost: number | null;
  cmp: number | null;
  grade: CmpGrade;
};

export type CmpBarState = {
  index: number;
  time: number;
  /** Stage after this bar was processed. */
  stage: CmpStage;
  sma: number | null;
  ema: number | null;
  vwap: number | null;
  cmp: number | null;
  ghost: number | null;
  hod: number;
  stall: number | null;
  /** Grade so far; meaningful from stage 2 on (null before). */
  grade: CmpGrade | null;
  dipHigh: number | null;
  /** v2 panel row: has price stayed under the CMP since the pullback? (stages 2-4) */
  setupUnderCMP: boolean | null;
  pullback: boolean;
  reclaim: boolean;
  /** Raw dip signal (also fires on a re-anchor in stage 4). */
  dip: boolean;
  /** Dip signal shown/alerted by the script: only while close is under the CMP. */
  dipShow: boolean;
  buy: CmpBuy | null;
  stopHit: boolean;
  targetHit: boolean;
  /** v2: the stop or T1 was hit on the entry bar itself. */
  exitOnEntryBar: boolean;
  /** v2: an open trade was closed at this bar's close by the daily reset ("EOD"). */
  eodExit: boolean;
};

export type CmpEvent =
  | { type: "strongMove"; index: number; time: number; spikeHigh: number }
  | { type: "pullback"; index: number; time: number; grade: CmpGrade; low: number; sma: number }
  | { type: "reclaim"; index: number; time: number; grade: CmpGrade }
  | { type: "dip"; index: number; time: number; dipHigh: number; reanchor: boolean; shown: boolean }
  | { type: "buy"; index: number; time: number; buy: CmpBuy }
  | { type: "target"; index: number; time: number; price: number; entryBar: boolean }
  | { type: "stop"; index: number; time: number; price: number; entryBar: boolean }
  | { type: "eod"; index: number; time: number; price: number }
  | { type: "reset"; index: number; time: number; from: CmpStage; reason: CmpResetReason };

export type CmpResetReason =
  | "newDay"
  | "lostEMA"
  | "tradedThroughAboveCMP"
  | "tradedThroughNoRoom"
  | "timeout";

export type CmpResult = {
  bars: CmpBarState[];
  events: CmpEvent[];
  settings: CmpSettings;
};

export type CmpInput = {
  /** Chart bars (extended hours), ascending by time. */
  bars: CmpBar[];
  /**
   * 60-minute extended-hours bars used for CMP / Ghost, as the script's
   * request.security(..., "60") does. Must cover the whole previous month for
   * a CMP. If omitted, hour bars are built from `bars`.
   */
  hourBars?: CmpBar[];
  /**
   * Optional completed-month H/L/C. When a month's predecessor is listed here
   * its CMP comes from this list instead of `hourBars`.
   */
  monthly?: MonthlyHLC[];
  settings?: Partial<CmpSettings>;
};

// ── Time helpers (exchange time zone) ────────────────────────────────────────

type ZonedParts = { year: number; month: number; day: number; hour: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(unixSeconds: number, timeZone: string): ZonedParts {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, fmt);
  }
  const parts: Partial<ZonedParts> = {};
  for (const p of fmt.formatToParts(new Date(unixSeconds * 1000))) {
    if (p.type === "year" || p.type === "month" || p.type === "day" || p.type === "hour") {
      parts[p.type] = Number(p.value);
    }
  }
  return parts as ZonedParts;
}

const dayKey = (p: ZonedParts) => p.year * 10000 + p.month * 100 + p.day;
const monthKey = (p: ZonedParts) => p.year * 12 + p.month;
const hourKey = (p: ZonedParts) => dayKey(p) * 100 + p.hour;

/** Aggregate bars into clock-hour bars in the exchange time zone. */
export function aggregateToHourBars(bars: CmpBar[], timeZone = CMP_DEFAULTS.timeZone): CmpBar[] {
  const out: CmpBar[] = [];
  let curKey: number | null = null;
  for (const b of bars) {
    const k = hourKey(zonedParts(b.time, timeZone));
    if (k !== curKey) {
      curKey = k;
      out.push({ time: b.time - (b.time % 3600), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    } else {
      const h = out[out.length - 1];
      h.high = Math.max(h.high, b.high);
      h.low = Math.min(h.low, b.low);
      h.close = b.close;
      h.volume += b.volume;
    }
  }
  return out;
}

// ── Indicators (Pine ta.* semantics, null = na) ──────────────────────────────

export function pineSma(src: number[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  for (let i = len - 1; i < src.length; i++) {
    let s = 0;
    for (let j = i - len + 1; j <= i; j++) s += src[j];
    out[i] = s / len;
  }
  return out;
}

export function pineEma(src: number[], len: number, seed: "sma" | "first" = "sma"): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  const alpha = 2 / (len + 1);
  let prev: number | null = null;
  for (let i = 0; i < src.length; i++) {
    if (prev === null) {
      if (seed === "first") prev = src[i];
      else if (i >= len - 1) {
        let s = 0;
        for (let j = i - len + 1; j <= i; j++) s += src[j];
        prev = s / len;
      }
    } else {
      prev = alpha * src[i] + (1 - alpha) * prev;
    }
    out[i] = prev;
  }
  return out;
}

/** ta.vwap(hlc3) anchored on each new trading day. */
export function pineDailyVwap(bars: CmpBar[], newDay: boolean[]): (number | null)[] {
  const out: (number | null)[] = [];
  let pv = 0;
  let v = 0;
  bars.forEach((b, i) => {
    if (newDay[i]) {
      pv = 0;
      v = 0;
    }
    const src = (b.high + b.low + b.close) / 3;
    pv += src * b.volume;
    v += b.volume;
    out.push(v === 0 ? null : pv / v);
  });
  return out;
}

// ── Monthly pivots (f_monthly via request.security "60", lookahead_on) ───────

type HourPivotRow = {
  time: number;
  hourKey: number;
  cmp: number | null;
  mtdHDone: number | null;
  mtdLDone: number | null;
  doneKey: number | null;
};

function computeHourPivots(hourBars: CmpBar[], timeZone: string, monthly: MonthlyHLC[] | undefined): HourPivotRow[] {
  const rows: HourPivotRow[] = [];
  let curH: number | null = null;
  let curL: number | null = null;
  let prvH: number | null = null;
  let prvL: number | null = null;
  let prvC: number | null = null;
  let lastC: number | null = null;
  let prevMKey: number | null = null;
  let prevCurH: number | null = null;
  let prevCurL: number | null = null;
  const override = new Map<number, MonthlyHLC>();
  for (const m of monthly ?? []) override.set(m.year * 12 + m.month, m);

  for (const b of hourBars) {
    const p = zonedParts(b.time, timeZone);
    const mKey = monthKey(p);
    const monthChange = prevMKey === null || mKey !== prevMKey;
    // values of curH/curL on the previous bar ([1])
    const curH1 = prevCurH;
    const curL1 = prevCurL;
    if (monthChange) {
      prvH = curH;
      prvL = curL;
      prvC = lastC;
      curH = b.high;
      curL = b.low;
    } else {
      curH = curH === null ? b.high : Math.max(curH, b.high);
      curL = curL === null ? b.low : Math.min(curL, b.low);
    }
    lastC = b.close;
    let piv = prvH !== null && prvL !== null && prvC !== null ? (prvH + prvL + prvC) / 3 : null;
    const prior = override.get(mKey - 1);
    if (prior) piv = (prior.high + prior.low + prior.close) / 3;
    rows.push({ time: b.time, hourKey: hourKey(p), cmp: piv, mtdHDone: curH1, mtdLDone: curL1, doneKey: prevMKey });
    prevMKey = mKey;
    prevCurH = curH;
    prevCurL = curL;
  }
  return rows;
}

// ── The state machine ────────────────────────────────────────────────────────

export function runCmpSystem(input: CmpInput): CmpResult {
  const s: CmpSettings = { ...CMP_DEFAULTS, ...(input.settings ?? {}) };
  const bars = input.bars;
  const tz = s.timeZone;
  const parts = bars.map((b) => zonedParts(b.time, tz));
  const closes = bars.map((b) => b.close);
  const sma = pineSma(closes, s.smaLen);
  const ema = pineEma(closes, s.emaLen, s.emaSeed);
  const newDayArr = parts.map((p, i) => i === 0 || dayKey(p) !== dayKey(parts[i - 1]));
  const vwap = pineDailyVwap(bars, newDayArr);

  const hourRows = computeHourPivots(input.hourBars ?? aggregateToHourBars(bars, tz), tz, input.monthly);
  // lookahead_on: the chart bar reads the hour bar that contains it; if that
  // hour is missing from hourBars, fall back to the latest earlier hour bar.
  let hp = -1;

  const out: CmpBarState[] = [];
  const events: CmpEvent[] = [];

  // `var` state
  let stage: CmpStage = 0;
  let spikeHigh: number | null = null;
  let spikeBar: number | null = null;
  let classA = false;
  let reclaimLow: number | null = null;
  let bounceLow: number | null = null;
  let dipHigh: number | null = null;
  let dipBar: number | null = null;
  let dipTime: number | null = null;
  let setupUnderCMP = true;
  const v2 = s.version === 2;
  let entryPx: number | null = null;
  let stopPx: number | null = null;
  let tgtPx: number | null = null;
  let hrH: number | null = null;
  let hrL: number | null = null;
  let hod: number | null = null;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const p = parts[i];
    const hk = hourKey(p);
    const t = b.time;

    // request.security row
    while (hp + 1 < hourRows.length && hourRows[hp + 1].hourKey <= hk && hourRows[hp + 1].time <= t) hp++;
    const row = hp >= 0 ? hourRows[hp] : null;
    const cmp = row ? row.cmp : null;

    // current, still-forming hour from the chart's own bars
    const hourChange = i === 0 || hk !== hourKey(parts[i - 1]);
    if (hourChange || hrH === null || hrL === null) {
      hrH = b.high;
      hrL = b.low;
    } else {
      hrH = Math.max(hrH, b.high);
      hrL = Math.min(hrL, b.low);
    }
    const curKey = monthKey(p);
    const sameMon = row !== null && row.doneKey === curKey && row.mtdHDone !== null && row.mtdLDone !== null;
    const ghostH = sameMon ? Math.max(row!.mtdHDone!, hrH) : hrH;
    const ghostL = sameMon ? Math.min(row!.mtdLDone!, hrL) : hrL;
    const ghost = (ghostH + ghostL + b.close) / 3;

    // intraday levels
    const newDay = newDayArr[i];
    const hodPrior: number | null = newDay ? null : hod;
    hod = newDay || hod === null ? b.high : Math.max(hod, b.high);
    const vw = vwap[i];
    const midStall = vw === null ? null : (vw + hod) / 2;

    const e = ema[i];
    const sm = sma[i];
    const tol = s.dipTolPct / 100;
    const dipTouch = e !== null && b.low <= e * (1 + tol);
    const dipHold = e !== null && b.close >= e * (1 - tol);
    const isDip = dipTouch && dipHold && b.close < b.open;
    const lostEMA = e !== null && b.close < e * (1 - tol);
    const underCMPnow = cmp === null || b.close < cmp;

    let pullbackSig = false;
    let reclaimSig = false;
    let dipSig = false;
    let buy: CmpBuy | null = null;
    let stopHit = false;
    let tgtHit = false;

    if (s.resetDaily && newDay) {
      if (v2 && stage === 5 && i > 0) {
        // v2: close the open trade at the prior day's last close, marked EOD
        const prev = bars[i - 1];
        events.push({ type: "eod", index: i - 1, time: prev.time, price: prev.close });
        out[i - 1].eodExit = true;
      }
      if (stage !== 0) events.push({ type: "reset", index: i, time: t, from: stage, reason: "newDay" });
      stage = 0;
    }

    const stageBefore: CmpStage = stage;
    let entryBar = false;
    const checkTrade = () => {
      if (b.low <= (stopPx as number)) stopHit = true;
      else if (b.high >= (tgtPx as number)) tgtHit = true;
      if (stopHit || tgtHit) {
        if (stopHit) events.push({ type: "stop", index: i, time: t, price: stopPx as number, entryBar });
        else events.push({ type: "target", index: i, time: t, price: tgtPx as number, entryBar });
        stage = 1;
        spikeHigh = hod;
        spikeBar = i;
      }
    };

    if (sm !== null) {
      if (stage === 0) {
        if (b.high >= sm * (1 + s.minMovePct / 100)) {
          stage = 1;
          spikeHigh = b.high;
          spikeBar = i;
          events.push({ type: "strongMove", index: i, time: t, spikeHigh: b.high });
        }
      } else if (stage === 1) {
        const newHigh = b.high > (spikeHigh as number);
        if (newHigh) {
          spikeHigh = b.high;
          spikeBar = i;
        }
        // v1: a new-high bar never counts; v2: a spike-and-flush bar can
        const canPull = v2 ? true : !newHigh && i > (spikeBar as number);
        if (canPull && b.low <= sm * (1 + s.proxPct / 100)) {
          stage = 2;
          classA = b.low <= sm;
          setupUnderCMP = underCMPnow;
          pullbackSig = true;
          events.push({ type: "pullback", index: i, time: t, grade: classA ? "A" : "B", low: b.low, sma: sm });
        }
      } else if (stage === 2) {
        if (b.low <= sm) classA = true;
        if (e !== null && b.close > e) {
          stage = 3;
          reclaimLow = b.low;
          bounceLow = null;
          reclaimSig = true;
          events.push({ type: "reclaim", index: i, time: t, grade: classA ? "A" : "B" });
        }
      } else if (stage === 3) {
        bounceLow = bounceLow === null ? b.low : Math.min(bounceLow, b.low);
        if (lostEMA) {
          stage = 2;
          events.push({ type: "reset", index: i, time: t, from: 3, reason: "lostEMA" });
        } else if (isDip) {
          stage = 4;
          dipHigh = b.high;
          dipBar = i;
          dipTime = t;
          dipSig = true;
        }
      } else if (stage === 4) {
        // v1 folds this bar's low into the stop first (Pine math.min(na, x) is na;
        // bounceLow is always set by stage 3). v2 uses only lows known before it.
        if (!v2) bounceLow = bounceLow === null ? null : Math.min(bounceLow, b.low);
        const dh = dipHigh as number;
        const fill = Math.max(b.open, dh + s.mintick);
        const t1: number | null = v2
          ? hodPrior
          : hodPrior === null
            ? (spikeHigh as number)
            : Math.max(hodPrior, spikeHigh as number);
        const cmpOK = !s.requireUnderCMP || cmp === null || fill < cmp;
        if (b.high > dh && cmpOK && t1 !== null && t1 > fill) {
          const bl = bounceLow ?? Number.NaN;
          const baseLow = s.includeReclaimLow ? Math.min(bl, reclaimLow ?? Number.NaN) : bl;
          entryPx = fill;
          stopPx = baseLow * (1 - s.stopBufPct / 100);
          tgtPx = t1;
          stage = 5;
          entryBar = true;
          buy = {
            entry: entryPx,
            stop: stopPx,
            t1: tgtPx,
            stall: midStall,
            ghost,
            cmp,
            grade: classA ? "A" : "B",
          };
          events.push({ type: "buy", index: i, time: t, buy });
        } else if (b.high > dh) {
          stage = 3;
          if (v2) bounceLow = null;
          events.push({ type: "reset", index: i, time: t, from: 4, reason: cmpOK ? "tradedThroughNoRoom" : "tradedThroughAboveCMP" });
        } else {
          if (v2) bounceLow = bounceLow === null ? null : Math.min(bounceLow, b.low);
          if (lostEMA) {
            stage = 2;
            events.push({ type: "reset", index: i, time: t, from: 4, reason: "lostEMA" });
          } else if (isDip) {
            dipHigh = b.high;
            dipBar = i;
            dipTime = t;
            dipSig = true;
          } else if (
            i - (dipBar as number) >= s.maxWaitBars ||
            (v2 && s.maxWaitMins > 0 && t - (dipTime as number) >= s.maxWaitMins * 60)
          ) {
            stage = 3;
            if (v2) bounceLow = null;
            events.push({ type: "reset", index: i, time: t, from: 4, reason: "timeout" });
          }
        }
      } else if (stage === 5) {
        // v1 only: the in-trade check runs on bars after the entry bar
        checkTrade();
      }
      // v2: in trade is checked on every bar, including the entry bar
      if (v2 && stage === 5) checkTrade();
    }

    if (stage >= 2 && stage <= 4 && !underCMPnow) setupUnderCMP = false;

    const dipShow = dipSig && (!s.requireUnderCMP || underCMPnow);
    if (dipSig) {
      events.push({ type: "dip", index: i, time: t, dipHigh: dipHigh as number, reanchor: stageBefore === 4, shown: dipShow });
    }

    out.push({
      index: i,
      time: t,
      stage,
      sma: sm,
      ema: e,
      vwap: vw,
      cmp,
      ghost,
      hod,
      stall: midStall,
      grade: stage >= 2 ? (classA ? "A" : "B") : null,
      dipHigh: stage === 4 ? dipHigh : null,
      setupUnderCMP: stage >= 2 && stage <= 4 ? setupUnderCMP : null,
      pullback: pullbackSig,
      reclaim: reclaimSig,
      dip: dipSig,
      dipShow,
      buy,
      stopHit,
      targetHit: tgtHit,
      exitOnEntryBar: (stopHit || tgtHit) && entryBar,
      eodExit: false,
    });
  }

  return { bars: out, events, settings: s };
}

/*
 * ── Parity notes (where exact TradingView parity is impossible or unverified) ──
 *
 * 1. Data. TradingView and Polygon build bars from slightly different trade
 *    condition filters (odd lots, out-of-sequence prints), and neither emits a
 *    bar for a minute with no trades. SMA/EMA/VWAP values therefore differ a
 *    little from the chart, and a near-threshold comparison can flip.
 * 2. ta.ema seeding. The Pine manual's pseudo-code seeds with the first close;
 *    the built-in returns na for len-1 bars and seeds with an SMA. We default to
 *    the SMA seed; after a few dozen bars the two are indistinguishable.
 * 3. History depth. TradingView computes the 200 SMA / 9 EMA from all chart
 *    history loaded; a port fed fewer bars starts later. SMA is exact once 200
 *    bars exist; EMA converges after ~50 bars.
 * 4. Session boundaries. timeframe.change("D") is modelled as a change of the
 *    New York calendar date of the bar open. TradingView's daily boundary for
 *    US stocks with extended hours is the 04:00 ET session start; since no
 *    bars print between 20:00 and 04:00 the two agree. "60" is the clock hour
 *    (TradingView's extended-hours hourly bars are on the hour).
 * 5. request.security with lookahead_on. The script only returns values known
 *    at the hour's open, so historical and realtime behaviour match; we read
 *    the hour bar containing the chart bar. A month's CMP needs hour bars for
 *    the whole previous month — pass `hourBars` (or `monthly`).
 * 6. Realtime vs. closed bars. Pine re-evaluates on every tick in realtime
 *    and rolls back `var` state until the bar closes; alerts (`alert.freq_
 *    once_per_bar`) can fire intrabar. This port evaluates closed bars only,
 *    which matches what the script shows on historical bars.
 * 7. mintick. syminfo.mintick comes from the symbol's pricescale; pass
 *    `mintick` explicitly (0.0001 for most sub-$1 stocks on TradingView).
 * 8. EOD exit (v2). Pine labels the exit on the previous bar when the new
 *    day's first bar arrives; here the `eod` event and `eodExit` flag are put
 *    on that previous bar.
 * 9. Floating point. Pine's ta.sma keeps a running sum; we re-sum the window.
 *    Differences are ~1e-15 and only matter for exact-equality touches.
 */
