// #528 Gainer Balloons: the data layer. One day of 2-minute bars goes in; the scene and the list ask
// one question of it, getStateAtTime(T): "what does every stock look like at time T?". Live and
// replay share that one path: Live asks for now, the scrubber asks for any earlier moment.
//
// Everything is worked out from the bars at or before T (never later ones), so the picture at 10:00
// is the same whether the day is still running or being replayed that evening, and scrubbing
// backwards gives exactly what scrubbing forwards gave.
// Pure: no three.js, no DOM, no network.
import { MARKET_HOURS, SCALES, getCountryProfile, type CountryProfile, type CountryTier } from "./config";

/** [start of the bar (epoch ms), open, high, low, close, volume] */
export type RawBar = [number, number, number, number, number, number];
export type RawStock = {
  ticker: string;
  country: string | null;
  floatShares: number | null;
  prevClose: number | null;
  /** #533: institutional ownership, in percent; null (or missing) when it was never looked up. */
  instOwnPct?: number | null;
  /** #533: shares outstanding, for the market cap at the time shown; null (or missing) when not known. */
  sharesOutstanding?: number | null;
  bars: RawBar[];
};
export type RawDay = {
  /** The trading day, YYYY-MM-DD (New York). */
  date: string;
  barMinutes?: number;
  /**
   * When the bars were read (epoch ms). A bar still forming at that moment holds only part of its
   * two minutes, so it is shown in full from then on instead of being stretched over the whole bar.
   */
  asOfMs?: number | null;
  stocks: RawStock[];
};

export type Session = "pre" | "regular" | "after";

export type StockState = {
  id: number;
  ticker: string;
  country: string | null;
  countryTier: CountryTier;
  countryLabel: string;
  stretchCap: number;
  elongationMax: number;
  colorHex: string;
  strainTintHex: string;
  floatShares: number | null;
  floatKnown: boolean;
  prevClose: number | null;
  instOwnPct: number | null;
  sharesOutstanding: number | null;
  refPrice: number;
  agility: number;
  hasTraded: boolean;
  price: number;
  pctChange: number;
  peakPctChange: number;
  liftLoss: number;
  cumVolume: number;
  barVolume: number;
  volumeToFloat: number | null;
  sizeNorm: number;
  baseRadius: number;
  radius: number;
  elongation: number;
  strain: number;
  overInflated: number;
  burst: number;
  burstAge: number;
};

export type Snapshot = { timeMs: number; session: Session; progress: number; stocks: StockState[] };

export type TimeBounds = {
  date: string;
  barMs: number;
  startMs: number;
  regularStartMs: number;
  regularEndMs: number;
  endMs: number;
  /** The end of the newest bar (or of what was read of it): where "the day so far" stops. */
  lastDataMs: number;
};

export type StockMetadata = {
  id: number;
  ticker: string;
  country: string | null;
  tier: CountryTier;
  stretchCap: number;
  floatShares: number | null;
  floatKnown: boolean;
  dayVolume: number;
  colorHex: string;
  strainTintHex: string;
};

export type MarketData = {
  getStateAtTime(timeMs: number): Snapshot;
  getActivityProfile(buckets?: number): Float32Array;
  getTimeBounds(): TimeBounds;
  getStockCount(): number;
  getStockMetadata(): StockMetadata[];
};

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(u: number) {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
}

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function nyOffsetMs(utcMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_HOURS.timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

/** The instant of a New York wall-clock time on a calendar day (daylight saving handled). */
export function nyEpochMs(date: string, minutesFromMidnight: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutesFromMidnight, 0);
  const provisional = guess - nyOffsetMs(guess);
  return guess - nyOffsetMs(provisional);
}

/** The largest index i with bars[i][0] <= timeMs, or -1. */
function findBarIndexAtOrBefore(bars: RawBar[], timeMs: number) {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid][0] <= timeMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Cumulative volume -> a 0..1 size and the balloon's base radius (log scale, clamped at both ends). */
export function mapVolumeScale(cumVol: number): { norm: number; baseRadius: number } {
  const cfg = SCALES.volume;
  if (!(cumVol > 0)) return { norm: 0, baseRadius: cfg.untradedRadius };
  const logMin = Math.log10(cfg.minShares);
  const logMax = Math.log10(cfg.maxShares);
  const norm = clamp((Math.log10(cumVol) - logMin) / (logMax - logMin), 0, 1);
  return { norm, baseRadius: cfg.minRadius + (cfg.maxBaseRadius - cfg.minRadius) * Math.pow(norm, cfg.power) };
}

/** Float -> lightness in 0..1. Low float = lighter = more movement. Unknown float: calm. */
export function mapAgility(floatShares: number | null): number {
  const cfg = SCALES.agility;
  if (floatShares == null || !(floatShares > 0)) return cfg.unknownAgility;
  const logMin = Math.log10(cfg.minFloat);
  const logMax = Math.log10(cfg.maxFloat);
  return 1 - clamp((Math.log10(floatShares) - logMin) / (logMax - logMin), 0, 1);
}

/** Percent change -> height. Straight up to +55%, gently compressed above, never into the ground. */
export function mapPctChangeToY(pctChange: number, radius = 0.6): number {
  const cfg = SCALES.altitude;
  let y: number;
  if (pctChange < 0) {
    y = cfg.zeroPctY - clamp(pctChange / cfg.negativeFloorPct, 0, 1) * cfg.negativeSpanY;
  } else if (pctChange <= cfg.linearKneePct) {
    y = cfg.zeroPctY + pctChange * cfg.linearSlopeY;
  } else {
    const kneeY = cfg.zeroPctY + cfg.linearKneePct * cfg.linearSlopeY;
    y = kneeY + Math.log1p((pctChange - cfg.linearKneePct) / 38) * cfg.logSlopeY;
  }
  return clamp(y, radius + cfg.minGroundClearance, cfg.maxY);
}

type PreparedStock = {
  id: number;
  ticker: string;
  country: string | null;
  profile: CountryProfile;
  floatShares: number | null;
  floatKnown: boolean;
  prevClose: number | null;
  instOwnPct: number | null;
  sharesOutstanding: number | null;
  refPrice: number;
  dayVolume: number;
  agility: number;
  bars: RawBar[];
  /** How long each bar runs for the picture: barMs, or less for a bar still forming when read. */
  lastBarSpanMs: number;
  cumVolAfter: Float64Array;
  runningPeakPct: Float32Array;
  barBurstStrength: Float32Array;
  burstIndices: number[];
};

/** Bars that can be drawn, oldest first, one per start time (a repeat keeps the later copy). */
export function cleanBars(bars: unknown): RawBar[] {
  if (!Array.isArray(bars)) return [];
  const byTime = new Map<number, RawBar>();
  for (const bar of bars) {
    if (!Array.isArray(bar) || bar.length < 6) continue;
    const [t, o, h, l, c, v] = bar as number[];
    if (![t, o, h, l, c].every((n) => typeof n === "number" && Number.isFinite(n)) || !(c > 0) || !(o > 0)) continue;
    byTime.set(t, [t, o, h, l, c, typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0]);
  }
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}

function prepareStock(raw: RawStock, index: number, barMs: number, asOfMs: number | null): PreparedStock {
  const bars = cleanBars(raw.bars);
  const n = bars.length;
  const profile = getCountryProfile(raw.country);
  const floatShares = positive(raw.floatShares) ? raw.floatShares : null;
  const prevClose = positive(raw.prevClose) ? raw.prevClose : null;
  // Without yesterday's close the change is measured from the day's first trade.
  const refPrice = prevClose ?? (n > 0 ? bars[0][1] : 1);

  const cumVolAfter = new Float64Array(n);
  const runningPeakPct = new Float32Array(n);
  const barBurstStrength = new Float32Array(n);
  const burstIndices: number[] = [];
  const cfg = SCALES.burst;

  let cum = 0;
  let peakPct = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const barVol = b[5];
    // The floor a burst must clear grows with the day so far (never with volume still to come).
    const volFloor = Math.max(cfg.minAbsoluteVolume, cum * cfg.dayShareFloor);
    cum += barVol;
    cumVolAfter[i] = cum;

    peakPct = Math.max(peakPct, ((b[2] - refPrice) / refPrice) * 100, ((b[4] - refPrice) / refPrice) * 100);
    runningPeakPct[i] = peakPct;

    let sumPrev = 0;
    let countPrev = 0;
    for (let j = Math.max(0, i - cfg.lookbackBars); j < i; j++) {
      sumPrev += bars[j][5];
      countPrev++;
    }
    const baseline = Math.max(countPrev > 0 ? sumPrev / countPrev : volFloor * 1.25, volFloor);
    const ratio = barVol / baseline;
    if (barVol >= cfg.minAbsoluteVolume && ratio >= cfg.ratioThreshold) {
      barBurstStrength[i] = clamp(Math.log2(ratio / (cfg.ratioThreshold * 0.72)) / 3.0, 0.2, 1.0);
      burstIndices.push(i);
    }
  }

  let lastBarSpanMs = barMs;
  if (n > 0 && asOfMs != null) {
    const lastStart = bars[n - 1][0];
    if (asOfMs > lastStart && asOfMs < lastStart + barMs) lastBarSpanMs = Math.max(1_000, asOfMs - lastStart);
  }

  return {
    id: index,
    ticker: raw.ticker,
    country: raw.country || null,
    profile,
    floatShares,
    floatKnown: floatShares !== null,
    prevClose,
    // 0% is a real answer (nobody holds it); anything else that isn't a count of percent is "not known".
    instOwnPct: typeof raw.instOwnPct === "number" && Number.isFinite(raw.instOwnPct) && raw.instOwnPct >= 0 ? raw.instOwnPct : null,
    sharesOutstanding: positive(raw.sharesOutstanding) ? raw.sharesOutstanding : null,
    refPrice,
    dayVolume: cum,
    agility: mapAgility(floatShares),
    bars,
    lastBarSpanMs,
    cumVolAfter,
    runningPeakPct,
    barBurstStrength,
    burstIndices,
  };
}

/** The ripple of the latest burst at or before timeMs (the same forwards and backwards). */
function evaluateBurst(stock: PreparedStock, timeMs: number, out: { intensity: number; age: number }) {
  out.intensity = 0;
  out.age = 1;
  const { burstIndices, bars, barBurstStrength } = stock;
  let lo = 0;
  let hi = burstIndices.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[burstIndices[mid]][0] <= timeMs) {
      best = burstIndices[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return;
  const elapsed = timeMs - bars[best][0];
  if (elapsed < 0 || elapsed > SCALES.burst.decayMs) return;
  const age = clamp(elapsed / SCALES.burst.decayMs, 0, 1);
  out.intensity = barBurstStrength[best] * smoothstep(elapsed / SCALES.burst.onsetMs) * Math.pow(1 - age, 1.85);
  out.age = age;
}

function untraded(out: StockState, refPrice: number) {
  out.hasTraded = false;
  out.price = refPrice;
  out.pctChange = 0;
  out.peakPctChange = 0;
  out.liftLoss = 0;
  out.cumVolume = 0;
  out.barVolume = 0;
  out.volumeToFloat = null;
  out.sizeNorm = 0;
  out.baseRadius = SCALES.volume.untradedRadius;
  out.radius = SCALES.volume.untradedRadius;
  out.elongation = 1.0;
  out.strain = 0;
  out.overInflated = 0;
  out.burst = 0;
  out.burstAge = 1;
}

/** Indexes one day of bars. Stocks keep the order they are given in; a stock's id is its index. */
export function createMarketData(raw: RawDay): MarketData {
  const barMs = (positive(raw.barMinutes) ? raw.barMinutes : 2) * 60_000;
  const date = raw.date;
  const startMs = nyEpochMs(date, MARKET_HOURS.dayStartMin);
  const regularStartMs = nyEpochMs(date, MARKET_HOURS.regularStartMin);
  const regularEndMs = nyEpochMs(date, MARKET_HOURS.regularEndMin);
  const endMs = nyEpochMs(date, MARKET_HOURS.dayEndMin);
  const asOfMs = typeof raw.asOfMs === "number" && Number.isFinite(raw.asOfMs) ? raw.asOfMs : null;

  const stocks = (raw.stocks ?? []).map((s, idx) => prepareStock(s, idx, barMs, asOfMs));
  let lastDataMs = startMs;
  for (const s of stocks) {
    const n = s.bars.length;
    if (n > 0) lastDataMs = Math.max(lastDataMs, s.bars[n - 1][0] + s.lastBarSpanMs);
  }
  lastDataMs = clamp(lastDataMs, startMs, endMs);

  // The same objects are filled in again on every call, so a frame makes no garbage.
  const stateBuffer: StockState[] = stocks.map((s) => {
    const state = {
      id: s.id,
      ticker: s.ticker,
      country: s.country,
      countryTier: s.profile.tier,
      countryLabel: s.profile.label,
      stretchCap: s.profile.stretchCap,
      elongationMax: s.profile.elongationMax,
      colorHex: s.profile.color,
      strainTintHex: s.profile.strainTint,
      floatShares: s.floatShares,
      floatKnown: s.floatKnown,
      prevClose: s.prevClose,
      instOwnPct: s.instOwnPct,
      sharesOutstanding: s.sharesOutstanding,
      refPrice: s.refPrice,
      agility: s.agility,
    } as StockState;
    untraded(state, s.refPrice);
    return state;
  });
  const burst = { intensity: 0, age: 1 };

  function getStateAtTime(timeMs: number): Snapshot {
    const t = clamp(timeMs, startMs, endMs);
    for (let i = 0; i < stocks.length; i++) {
      const s = stocks[i];
      const out = stateBuffer[i];
      const bars = s.bars;
      const n = bars.length;
      if (n === 0 || t < bars[0][0]) {
        untraded(out, s.refPrice);
        continue;
      }
      const idx = findBarIndexAtOrBefore(bars, t);
      const bar = bars[idx];
      const barStart = bar[0];
      const span = idx === n - 1 ? s.lastBarSpanMs : barMs;
      const prevCum = idx > 0 ? s.cumVolAfter[idx - 1] : 0;
      const barVol = bar[5];

      let cumVol: number;
      let price: number;
      let peakPct: number;
      let activeBarVol: number;
      if (t < barStart + span) {
        // Inside the bar: volume fills in evenly, price eases from the last close to this one.
        const u = clamp((t - barStart) / span, 0, 1);
        cumVol = prevCum + barVol * u;
        const startPrice = idx > 0 ? bars[idx - 1][4] : bar[1];
        price = startPrice + (bar[4] - startPrice) * smoothstep(u);
        const prevPeak = idx > 0 ? s.runningPeakPct[idx - 1] : 0;
        peakPct = Math.max(prevPeak, ((price - s.refPrice) / s.refPrice) * 100);
        activeBarVol = barVol;
      } else {
        // After the bar, in a quiet gap: nothing has traded since.
        cumVol = s.cumVolAfter[idx];
        price = bar[4];
        peakPct = s.runningPeakPct[idx];
        activeBarVol = 0;
      }

      const pctChange = ((price - s.refPrice) / s.refPrice) * 100;
      const { norm: sizeNorm, baseRadius } = mapVolumeScale(cumVol);

      let volumeToFloat: number | null = null;
      let strain = 0;
      let overInflated = 0;
      let stretchFactor = 1.0;
      let elongation = 1.0;
      if (s.floatKnown) {
        volumeToFloat = cumVol / s.floatShares!;
        const cfg = SCALES.strain;
        if (volumeToFloat > cfg.onsetRotation) {
          strain = clamp(
            Math.log1p((volumeToFloat - cfg.onsetRotation) * 1.4) / Math.log1p((cfg.saturationRotation - cfg.onsetRotation) * 1.4),
            0,
            1,
          );
        }
        if (volumeToFloat > cfg.fullFloatRotation) {
          overInflated = clamp(Math.log1p(volumeToFloat - cfg.fullFloatRotation) / Math.log1p(cfg.saturationRotation), 0, 1);
        }
        // The country sets how far the balloon can stretch as its float turns over.
        const stretchDrive = Math.pow(strain, 0.82);
        stretchFactor = 1.0 + (s.profile.stretchCap - 1.0) * stretchDrive;
        elongation = 1.0 + (s.profile.elongationMax - 1.0) * stretchDrive;
      } else {
        // Unknown float: no strain is shown. Only a gentle, country-sized swell from raw volume.
        const rawDrive = Math.pow(sizeNorm, 1.35) * 0.55;
        stretchFactor = 1.0 + (s.profile.stretchCap - 1.0) * rawDrive;
        elongation = 1.0 + (s.profile.elongationMax - 1.0) * rawDrive * 0.6;
      }

      const ll = SCALES.liftLoss;
      let liftLoss = 0;
      if (peakPct >= ll.minPeakPct && cumVol >= ll.minVolumeForHeaviness) {
        const drawdown = Math.max(0, peakPct - pctChange);
        const volWeight = clamp(Math.log10(cumVol / ll.minVolumeForHeaviness) / 1.8, 0.25, 1.0);
        liftLoss = clamp(drawdown / ll.fullDrawdownPct, 0, 1) * volWeight;
      }

      evaluateBurst(s, t, burst);

      out.hasTraded = true;
      out.price = price;
      out.pctChange = pctChange;
      out.peakPctChange = peakPct;
      out.liftLoss = liftLoss;
      out.cumVolume = cumVol;
      out.barVolume = activeBarVol;
      out.volumeToFloat = volumeToFloat;
      out.sizeNorm = sizeNorm;
      out.baseRadius = baseRadius;
      out.radius = baseRadius * stretchFactor;
      out.elongation = elongation;
      out.strain = strain;
      out.overInflated = overInflated;
      out.burst = burst.intensity;
      out.burstAge = burst.age;
    }
    return {
      timeMs: t,
      session: t < regularStartMs ? "pre" : t < regularEndMs ? "regular" : "after",
      progress: (t - startMs) / (endMs - startMs),
      stocks: stateBuffer,
    };
  }

  /** The whole field's volume through the day in `buckets` steps, 0..1 (log), for the scrubber. */
  function getActivityProfile(buckets = 160): Float32Array {
    const arr = new Float32Array(buckets);
    const span = endMs - startMs;
    for (const s of stocks) {
      for (const b of s.bars) {
        const idx = Math.floor(((b[0] - startMs) / span) * buckets);
        if (idx >= 0 && idx < buckets) arr[idx] += b[5];
      }
    }
    let maxLog = 0;
    for (let i = 0; i < buckets; i++) {
      arr[i] = arr[i] > 0 ? Math.log1p(arr[i]) : 0;
      if (arr[i] > maxLog) maxLog = arr[i];
    }
    if (maxLog > 0) for (let i = 0; i < buckets; i++) arr[i] /= maxLog;
    return arr;
  }

  return {
    getStateAtTime,
    getActivityProfile,
    getTimeBounds: () => ({ date, barMs, startMs, regularStartMs, regularEndMs, endMs, lastDataMs }),
    getStockCount: () => stocks.length,
    getStockMetadata: () =>
      stocks.map((s) => ({
        id: s.id,
        ticker: s.ticker,
        country: s.country,
        tier: s.profile.tier,
        stretchCap: s.profile.stretchCap,
        floatShares: s.floatShares,
        floatKnown: s.floatKnown,
        dayVolume: s.dayVolume,
        colorHex: s.profile.color,
        strainTintHex: s.profile.strainTint,
      })),
  };
}

/** What the server sends: one day, its stocks, and the server's clock. */
export type BalloonsFeed = {
  /** The trading day shown, YYYY-MM-DD (New York). */
  day: string;
  /** Today in New York, as the server sees it. */
  today: string;
  /** The server's clock when it answered (epoch ms). */
  now: number;
  barMinutes: number;
  /** Set when only bars from this time on were sent (the browser asked with ?since=). */
  since: number | null;
  stocks: Array<RawStock & { /** How many of the day's bars come before `since` (not sent). */ earlier: number }>;
};

/**
 * Adds a "bars since" answer to the day the browser already holds. Null when they don't fit (a new
 * day, a stock the browser hasn't seen, or a different count of earlier bars): the browser then asks
 * for the whole day again.
 */
export function mergeFeed(held: BalloonsFeed | null, next: BalloonsFeed): BalloonsFeed | null {
  if (next.since == null) return next;
  if (!held || held.day !== next.day) return null;
  const since = next.since;
  const heldByTicker = new Map(held.stocks.map((s) => [s.ticker, s]));
  const stocks: BalloonsFeed["stocks"] = [];
  for (const stock of next.stocks) {
    const before = (heldByTicker.get(stock.ticker)?.bars ?? []).filter((b) => b[0] < since);
    if (before.length !== stock.earlier) return null;
    stocks.push({ ...stock, earlier: 0, bars: [...before, ...stock.bars] });
  }
  return { ...next, since: null, stocks };
}
