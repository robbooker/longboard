import { isPremarket, rossCameronMomentum, rvolLookbackForResolution } from "@/lib/indicators";
import {
  etDateLookbackStart,
  fetchBars,
  fetchBarsForDay,
  fetchBarsForLookback,
  type IntradayResolution,
} from "@/lib/polygon/bars";
import { formatEtTime, nyClockToUtcMs, polygonGet } from "@/lib/polygon/client";
import type { Bar } from "@/lib/polygon/types";
import { etDateIsoFromUnixSeconds, etMinutesOfDay } from "@/lib/time/etClock";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";
import { snapshotCumulativeVolume } from "./snapshotVolume";
import { historicalTimeOfDayRvol } from "./rvolTimeOfDay";

type RawSnapshotTicker = {
  ticker?: string;
  todaysChange?: number;
  todaysChangePerc?: number;
  updated?: number;
  lastTrade?: { p?: number };
  day?: { c?: number; h?: number; v?: number; vw?: number };
  prevDay?: { c?: number };
  min?: { c?: number; h?: number; v?: number; av?: number };
};

type ReferenceResult = {
  active?: boolean;
  name?: string;
  ticker?: string;
  type?: string;
  market?: string;
  primary_exchange?: string;
};

type SnapshotCandidate = {
  ticker: string;
  change: number;
  changePct: number;
  priceNow: number;
  dayHigh?: number | null;
  dayVolume: number;
  dollarVolume: number;
  updated?: number;
};

export type RvolScannerCandidate = SnapshotCandidate & {
  name: string | null;
  referenceType: string | null;
  primaryExchange: string | null;
};

export type RvolScannerHit = RvolScannerCandidate & {
  resolution: IntradayResolution;
  signalTimeEt: string;
  signalUnixSeconds: number;
  signalPrice: number;
  signalRvol: number;
  breakoutLevel: number;
  breakoutMode: "premarketHigh" | "openingRangeHigh" | "twoWeekHigh" | "monthToDateHigh";
  rvolMethod: "sameDayRolling" | "historicalTimeOfDay";
  cumulativeVolumePace: number | null;
  barsScanned: number;
};

export type RvolScanDiagnostic = {
  etDate: string;
  resolution: IntradayResolution;
  ticker: string;
  evaluatedAt: string;
  qualified: boolean;
  breakoutMode: RvolScannerHit["breakoutMode"];
  rvolMethod: RvolScannerHit["rvolMethod"];
  bestBarUnixSeconds: number | null;
  bestBarTimeEt: string | null;
  rejectionReasons: string[];
  conditionsPassed: number;
  signalRvol: number | null;
  breakoutLevel: number | null;
  cumulativeVolume: number;
  cumulativeVolumePace: number | null;
  baselineSessions: number;
};

export type RvolScannerResult = {
  etDate: string;
  fetchedAt: string;
  source: "polygon";
  resolution: IntradayResolution;
  universe: {
    snapshotPool: number;
    candidateLimit: number;
    candidateOffset: number;
    rawCandidateCount: number;
    minPrice: number;
    minMovePct: number;
    minDayVolume: number;
    maxPrice: number | null;
    primaryExchanges: string[] | null;
  };
  scanned: number;
  hits: RvolScannerHit[];
  candidates: RvolScannerCandidate[];
  diagnostics: RvolScanDiagnostic[];
};

export type RvolScannerOptions = {
  etDate?: string;
  resolution?: IntradayResolution;
  snapshotPool?: number;
  candidateLimit?: number;
  candidateOffset?: number;
  minPrice?: number;
  minMovePct?: number;
  minDayVolume?: number;
  maxPrice?: number | null;
  primaryExchanges?: string[];
};

const DEFAULT_SNAPSHOT_POOL = 120;
const DEFAULT_CANDIDATE_LIMIT = 40;
const DEFAULT_MIN_PRICE = 1;
const DEFAULT_MIN_MOVE_PCT = 5;
const DEFAULT_MIN_DAY_VOLUME = 100_000;
const DEFAULT_MAX_PRICE = 20;
const REFERENCE_BATCH_SIZE = 8;
const BAR_BATCH_SIZE = 5;
const SIGNAL_START_MINUTES_ET = 8 * 60;
const HISTORICAL_RVOL_LOOKBACK_DAYS = 45;
const LONG_TERM_LOOKBACK_DAYS: Partial<Record<IntradayResolution, number>> = {
  "1h": 45,
  "4h": 120,
};

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizedTicker(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const ticker = input.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,5}$/.test(ticker)) return null;
  if (/(WS|WT|W|R|U)$/.test(ticker)) return null;
  return ticker;
}

export function isLikelySpacName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\b(acquisition|blank check|spac|special purpose)\b/i.test(name);
}

function isCommonOperatingStock(
  ref: ReferenceResult | null,
  opts: { primaryExchanges?: string[] } = {},
): boolean {
  if (!ref || ref.active === false) return false;
  const type = ref.type?.toUpperCase() ?? "";
  const market = ref.market?.toLowerCase() ?? "";
  const primaryExchange = ref.primary_exchange?.trim().toUpperCase() ?? "";
  if (market && market !== "stocks") return false;
  if (type !== "CS") return false;
  if (
    opts.primaryExchanges &&
    opts.primaryExchanges.length > 0 &&
    !opts.primaryExchanges.includes(primaryExchange)
  ) {
    return false;
  }
  if (isLikelySpacName(ref.name)) return false;
  return true;
}

function snapshotPrice(ticker: RawSnapshotTicker): number | null {
  const candidates = [ticker.lastTrade?.p, ticker.min?.c, ticker.day?.c];
  for (const price of candidates) {
    if (positiveNumber(price)) return price;
  }
  return null;
}

function snapshotDayHigh(ticker: RawSnapshotTicker, priceNow: number): number | null {
  const highs = [ticker.day?.h, ticker.min?.h, priceNow].filter(positiveNumber);
  if (highs.length === 0) return null;
  return Math.max(...highs);
}

function etMinutes(unixSeconds: number): number {
  return etMinutesOfDay(unixSeconds);
}

function etDateFromUnixSeconds(unixSeconds: number): string {
  return etDateIsoFromUnixSeconds(unixSeconds);
}

function breakoutModeForResolution(
  resolution: IntradayResolution,
): RvolScannerHit["breakoutMode"] {
  if (resolution === "1h") return "twoWeekHigh";
  if (resolution === "4h") return "monthToDateHigh";
  return "premarketHigh";
}

async function fetchBarsForSignalScan(
  ticker: string,
  etDateIso: string,
  resolution: IntradayResolution,
) {
  const lookbackDays = LONG_TERM_LOOKBACK_DAYS[resolution];
  if (lookbackDays) {
    return fetchBarsForLookback(ticker, etDateIso, resolution, lookbackDays);
  }
  return fetchBarsForDay(ticker, etDateIso, resolution);
}

function toSnapshotCandidates(
  rows: RawSnapshotTicker[],
  opts: {
    minPrice: number;
    minMovePct: number;
    minDayVolume: number;
    snapshotPool: number;
  },
): SnapshotCandidate[] {
  const candidates: SnapshotCandidate[] = [];

  for (const row of rows) {
    const ticker = normalizedTicker(row.ticker);
    if (!ticker) continue;

    const priceNow = snapshotPrice(row);
    const prevClose = row.prevDay?.c;
    if (!positiveNumber(priceNow) || !positiveNumber(prevClose)) continue;
    if (priceNow < opts.minPrice) continue;

    const change = priceNow - prevClose;
    const changePct = (change / prevClose) * 100;
    if (changePct < opts.minMovePct) continue;

    const dayVolume = snapshotCumulativeVolume(row);
    const dayHigh = snapshotDayHigh(row, priceNow);
    const dollarVolume = dayVolume * priceNow;
    if (dayVolume < opts.minDayVolume) continue;

    candidates.push({
      ticker,
      change,
      changePct,
      priceNow,
      dayHigh,
      dayVolume,
      dollarVolume,
      updated: row.updated,
    });
  }

  return candidates
    .sort((a, b) => b.changePct - a.changePct || b.dayVolume - a.dayVolume)
    .slice(0, opts.snapshotPool);
}

// Ticker reference data (name, type, primary exchange) does not change during a session,
// and every scan asks for the same ~90 tickers (twice: once per resolution). Keep answers
// on this server instance for an hour. Failed lookups are not kept, so a Polygon error is
// retried on the next scan exactly as before.
const REFERENCE_TTL_MS = 60 * 60 * 1000;
const MAX_REFERENCE_ENTRIES = 5_000;
const referenceCache = new Map<string, { at: number; value: Promise<ReferenceResult | null> }>();

async function fetchReference(ticker: string): Promise<ReferenceResult | null> {
  const now = Date.now();
  const cached = referenceCache.get(ticker);
  if (cached && now - cached.at < REFERENCE_TTL_MS) {
    try {
      return await cached.value;
    } catch {
      return null;
    }
  }

  const value = polygonGet<{ results?: ReferenceResult }>(
    `/v3/reference/tickers/${encodeURIComponent(ticker)}`,
  ).then((data) => data.results ?? null);
  if (referenceCache.size >= MAX_REFERENCE_ENTRIES) referenceCache.clear();
  referenceCache.set(ticker, { at: now, value });
  try {
    return await value;
  } catch {
    if (referenceCache.get(ticker)?.value === value) referenceCache.delete(ticker);
    return null;
  }
}

// Prior-session 5m bars for the historical time-of-day RVOL baseline. Earlier sessions do
// not change during the day, so fetch them once per ticker and day (not the whole 45 days
// again every five minutes). Only bars before the scan day are requested, which is all
// the old code kept from its wider request. Failures are not kept.
const MAX_HISTORY_ENTRIES = 100;
const historyCache = new Map<string, Promise<Bar[]>>();

function fetchPriorSessionBars(ticker: string, etDate: string, lookbackDays: number): Promise<Bar[]> {
  const key = `${ticker}:${etDate}:${lookbackDays}`;
  const cached = historyCache.get(key);
  if (cached) return cached;

  const [fromYear, fromMonth, fromDay] = etDateLookbackStart(etDate, lookbackDays).split("-").map(Number);
  const [year, month, day] = etDate.split("-").map(Number);
  const value = fetchBars({
    ticker,
    fromMs: nyClockToUtcMs(fromYear, fromMonth, fromDay, 4, 0),
    toMs: nyClockToUtcMs(year, month, day, 4, 0) - 1,
    resolution: "5m",
    extendedHours: true,
  }).then((bars) => bars.filter((bar) => etDateFromUnixSeconds(bar.time) !== etDate));
  if (historyCache.size >= MAX_HISTORY_ENTRIES) {
    const oldest = historyCache.keys().next().value;
    if (oldest !== undefined) historyCache.delete(oldest);
  }
  historyCache.set(key, value);
  value.catch(() => {
    if (historyCache.get(key) === value) historyCache.delete(key);
  });
  return value;
}

/** Test hook: forget per-instance reference and history caches. */
export function resetRvolScannerCachesForTests() {
  referenceCache.clear();
  historyCache.clear();
}

async function filterReferenceCandidates(
  candidates: SnapshotCandidate[],
  limit: number,
  opts: { primaryExchanges?: string[] } = {},
): Promise<RvolScannerCandidate[]> {
  const kept: RvolScannerCandidate[] = [];

  for (let i = 0; i < candidates.length && kept.length < limit; i += REFERENCE_BATCH_SIZE) {
    const batch = candidates.slice(i, i + REFERENCE_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const refs = await Promise.all(batch.map((candidate) => fetchReference(candidate.ticker)));
    for (let j = 0; j < batch.length; j++) {
      const ref = refs[j];
      if (!isCommonOperatingStock(ref, opts)) continue;
      kept.push({
        ...batch[j],
        name: ref?.name?.trim() || null,
        referenceType: ref?.type ?? null,
        primaryExchange: ref?.primary_exchange?.trim() || null,
      });
      if (kept.length >= limit) break;
    }
  }

  return kept;
}

export async function fetchCurrentRvolSnapshotCandidates(
  tickers: string[],
): Promise<Map<string, RvolScannerCandidate>> {
  const requestedTickers = Array.from(
    new Set(tickers.map((ticker) => normalizedTicker(ticker)).filter((ticker): ticker is string => Boolean(ticker))),
  );
  const empty = new Map<string, RvolScannerCandidate>();
  if (requestedTickers.length === 0) return empty;

  const snapshot = await polygonGet<{ tickers?: RawSnapshotTicker[] }>(
    "/v2/snapshot/locale/us/markets/stocks/tickers",
  );
  const requested = new Set(requestedTickers);
  const snapshotByTicker = new Map<string, RawSnapshotTicker>();
  for (const row of snapshot.tickers ?? []) {
    const ticker = normalizedTicker(row.ticker);
    if (!ticker || !requested.has(ticker)) continue;
    snapshotByTicker.set(ticker, row);
  }

  const result = new Map<string, RvolScannerCandidate>();
  for (let i = 0; i < requestedTickers.length; i += REFERENCE_BATCH_SIZE) {
    const batch = requestedTickers.slice(i, i + REFERENCE_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const refs = await Promise.all(batch.map((ticker) => fetchReference(ticker)));
    for (let j = 0; j < batch.length; j++) {
      const ticker = batch[j];
      const row = snapshotByTicker.get(ticker);
      const priceNow = row ? snapshotPrice(row) : null;
      if (!row || !positiveNumber(priceNow)) continue;

      const prevClose = row?.prevDay?.c;
      const change = positiveNumber(prevClose) ? priceNow - prevClose : 0;
      const changePct = positiveNumber(prevClose) ? (change / prevClose) * 100 : 0;
      const dayVolume = snapshotCumulativeVolume(row);
      const dayHigh = snapshotDayHigh(row, priceNow);
      const ref = refs[j];

      result.set(ticker, {
        ticker,
        change,
        changePct,
        priceNow,
        dayHigh,
        dayVolume,
        dollarVolume: dayVolume * priceNow,
        updated: row?.updated,
        name: ref?.name?.trim() || null,
        referenceType: ref?.type ?? null,
        primaryExchange: ref?.primary_exchange?.trim() || null,
      });
    }
  }

  return result;
}

async function scanCandidate(
  candidate: RvolScannerCandidate,
  etDate: string,
  resolution: IntradayResolution,
  maxPrice: number,
): Promise<{ hit: RvolScannerHit | null; diagnostic: RvolScanDiagnostic }> {
  const bars = await fetchBarsForSignalScan(candidate.ticker, etDate, resolution);
  const evaluatedAt = new Date().toISOString();
  if (bars.length === 0) {
    return {
      hit: null,
      diagnostic: {
        etDate,
        resolution,
        ticker: candidate.ticker,
        evaluatedAt,
        qualified: false,
        breakoutMode: breakoutModeForResolution(resolution),
        rvolMethod: "sameDayRolling",
        bestBarUnixSeconds: null,
        bestBarTimeEt: null,
        rejectionReasons: ["NO_BARS"],
        conditionsPassed: 0,
        signalRvol: null,
        breakoutLevel: null,
        cumulativeVolume: 0,
        cumulativeVolumePace: null,
        baselineSessions: 0,
      },
    };
  }

  const hasPremarketActivity = bars.some((bar) => isPremarket(bar.time) && bar.volume > 0);
  const useOpeningRangeFallback = resolution === "5m" && !hasPremarketActivity;
  const breakoutMode: RvolScannerHit["breakoutMode"] = useOpeningRangeFallback
    ? "openingRangeHigh"
    : breakoutModeForResolution(resolution);
  let rvolMethod: RvolScannerHit["rvolMethod"] = "sameDayRolling";
  let rvolValues: number[] | undefined;
  let cumulativeVolumePace = new Array(bars.length).fill(NaN);
  let baselineSessions = 0;
  if (useOpeningRangeFallback) {
    try {
      const historical = await fetchPriorSessionBars(candidate.ticker, etDate, HISTORICAL_RVOL_LOOKBACK_DAYS);
      const metrics = historicalTimeOfDayRvol(bars, historical);
      rvolValues = metrics.rvol;
      cumulativeVolumePace = metrics.cumulativeVolumePace;
      baselineSessions = metrics.baselineSessions;
      rvolMethod = "historicalTimeOfDay";
    } catch {
      rvolValues = new Array(bars.length).fill(NaN);
      rvolMethod = "historicalTimeOfDay";
    }
  }
  const indicator = rossCameronMomentum(bars, {
    rvolLookback: rvolLookbackForResolution(resolution),
    breakoutMode,
    maxPrice,
    rvolValues,
  });

  const entryIndex = indicator.entries.findIndex((entry, index) =>
    entry && etDateFromUnixSeconds(bars[index].time) === etDate && etMinutes(bars[index].time) >= SIGNAL_START_MINUTES_ET,
  );
  const eligibleIndexes = bars
    .map((bar, index) => ({ bar, index }))
    .filter(({ bar }) => etDateFromUnixSeconds(bar.time) === etDate && etMinutes(bar.time) >= SIGNAL_START_MINUTES_ET);
  const bestIndex = entryIndex >= 0
    ? entryIndex
    : eligibleIndexes.reduce<number | null>((best, { index }) => {
      if (best == null) return index;
      const current = indicator.entryDiagnostics[index];
      const prior = indicator.entryDiagnostics[best];
      if (current.conditionsPassed !== prior.conditionsPassed) {
        return current.conditionsPassed > prior.conditionsPassed ? index : best;
      }
      const currentRvol = Number.isFinite(indicator.rvol[index]) ? indicator.rvol[index] : -Infinity;
      const priorRvol = Number.isFinite(indicator.rvol[best]) ? indicator.rvol[best] : -Infinity;
      return currentRvol >= priorRvol ? index : best;
    }, null);
  const bestBar = bestIndex == null ? null : bars[bestIndex];
  const bestEntryDiagnostic = bestIndex == null ? null : indicator.entryDiagnostics[bestIndex];
  const cumulativeVolume = bestIndex == null
    ? 0
    : bars.slice(0, bestIndex + 1).reduce((sum, bar) => sum + Math.max(0, bar.volume), 0);
  const rejectionReasons: string[] = entryIndex >= 0
    ? []
    : [...(bestEntryDiagnostic?.rejectionReasons ?? ["NO_QUALIFYING_BAR"])];
  if (!hasPremarketActivity && !useOpeningRangeFallback && rejectionReasons.includes("BREAKOUT_LEVEL_UNAVAILABLE")) {
    rejectionReasons.push("NO_PREMARKET_ACTIVITY");
  }
  const diagnostic: RvolScanDiagnostic = {
    etDate,
    resolution,
    ticker: candidate.ticker,
    evaluatedAt,
    qualified: entryIndex >= 0,
    breakoutMode,
    rvolMethod,
    bestBarUnixSeconds: bestBar?.time ?? null,
    bestBarTimeEt: bestBar ? formatEtTime(bestBar.time) : null,
    rejectionReasons,
    conditionsPassed: bestEntryDiagnostic?.conditionsPassed ?? 0,
    signalRvol: bestIndex != null && Number.isFinite(indicator.rvol[bestIndex]) ? indicator.rvol[bestIndex] : null,
    breakoutLevel: bestIndex != null && Number.isFinite(indicator.breakoutLevel[bestIndex]) ? indicator.breakoutLevel[bestIndex] : null,
    cumulativeVolume: Math.round(cumulativeVolume),
    cumulativeVolumePace: bestIndex != null && Number.isFinite(cumulativeVolumePace[bestIndex]) ? cumulativeVolumePace[bestIndex] : null,
    baselineSessions,
  };
  if (entryIndex === -1) return { hit: null, diagnostic };

  const signalBar = bars[entryIndex];
  return {
    hit: {
      ...candidate,
      resolution,
      signalTimeEt: formatEtTime(signalBar.time),
      signalUnixSeconds: signalBar.time,
      signalPrice: signalBar.close,
      signalRvol: indicator.rvol[entryIndex],
      breakoutLevel: indicator.breakoutLevel[entryIndex],
      breakoutMode,
      rvolMethod,
      cumulativeVolumePace: Number.isFinite(cumulativeVolumePace[entryIndex]) ? cumulativeVolumePace[entryIndex] : null,
      barsScanned: bars.length,
    },
    diagnostic,
  };
}

export async function scanRvolBuySignals(
  options: RvolScannerOptions = {},
): Promise<RvolScannerResult> {
  const [result] = await scanRvolBuySignalsForResolutions([options.resolution ?? "1m"], options);
  return result;
}

/**
 * Scans several resolutions with the same universe options. The market snapshot and the
 * ticker reference checks are identical for every resolution, so they are fetched once and
 * shared; each resolution then scans its own bars exactly as a separate call would.
 */
export async function scanRvolBuySignalsForResolutions(
  resolutions: readonly IntradayResolution[],
  options: Omit<RvolScannerOptions, "resolution"> = {},
): Promise<RvolScannerResult[]> {
  const etDate = options.etDate ?? mostRecentTradingDay();
  const snapshotPool = options.snapshotPool ?? DEFAULT_SNAPSHOT_POOL;
  const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const candidateOffset = Math.max(0, Math.floor(options.candidateOffset ?? 0));
  const minPrice = options.minPrice ?? DEFAULT_MIN_PRICE;
  const minMovePct = options.minMovePct ?? DEFAULT_MIN_MOVE_PCT;
  const minDayVolume = Math.max(0, options.minDayVolume ?? DEFAULT_MIN_DAY_VOLUME);
  const maxPrice = options.maxPrice === null
    ? Number.POSITIVE_INFINITY
    : options.maxPrice ?? DEFAULT_MAX_PRICE;
  const primaryExchanges = options.primaryExchanges?.map((exchange) => exchange.trim().toUpperCase()).filter(Boolean);

  const snapshot = await polygonGet<{ tickers?: RawSnapshotTicker[] }>(
    "/v2/snapshot/locale/us/markets/stocks/tickers",
  );
  const rawCandidates = toSnapshotCandidates(snapshot.tickers ?? [], {
    minPrice,
    minMovePct,
    minDayVolume,
    snapshotPool,
  });
  const candidates = await filterReferenceCandidates(rawCandidates.slice(candidateOffset), candidateLimit, {
    primaryExchanges,
  });

  return Promise.all(resolutions.map(async (resolution): Promise<RvolScannerResult> => {
    const hits: RvolScannerHit[] = [];
    const diagnostics: RvolScanDiagnostic[] = [];

    for (let i = 0; i < candidates.length; i += BAR_BATCH_SIZE) {
      const batch = candidates.slice(i, i + BAR_BATCH_SIZE);
      // eslint-disable-next-line no-await-in-loop
      const batchScans = await Promise.all(
        batch.map((candidate) =>
          scanCandidate(candidate, etDate, resolution, maxPrice).catch(() => null),
        ),
      );
      for (const scan of batchScans) {
        if (!scan) continue;
        diagnostics.push(scan.diagnostic);
        if (scan.hit) hits.push(scan.hit);
      }
    }

    hits.sort((a, b) => b.changePct - a.changePct || a.signalUnixSeconds - b.signalUnixSeconds);

    return {
      etDate,
      fetchedAt: new Date().toISOString(),
      source: "polygon",
      resolution,
      universe: {
        snapshotPool,
        candidateLimit,
        candidateOffset,
        rawCandidateCount: rawCandidates.length,
        minPrice,
        minMovePct,
        minDayVolume,
        maxPrice: Number.isFinite(maxPrice) ? maxPrice : null,
        primaryExchanges: primaryExchanges && primaryExchanges.length > 0 ? primaryExchanges : null,
      },
      scanned: candidates.length,
      hits,
      candidates,
      diagnostics,
    };
  }));
}
