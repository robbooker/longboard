import { rossCameronMomentum, rvolLookbackForResolution } from "@/lib/indicators";
import { fetchBarsForDay, fetchBarsForLookback, type IntradayResolution } from "@/lib/polygon/bars";
import { formatEtTime, polygonGet } from "@/lib/polygon/client";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";

type RawSnapshotTicker = {
  ticker?: string;
  todaysChange?: number;
  todaysChangePerc?: number;
  updated?: number;
  lastTrade?: { p?: number };
  day?: { c?: number; v?: number; vw?: number };
  prevDay?: { c?: number };
  min?: { c?: number; v?: number; av?: number };
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
  breakoutMode: "premarketHigh" | "twoWeekHigh" | "monthToDateHigh";
  barsScanned: number;
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

function etMinutes(unixSeconds: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(unixSeconds * 1000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

function etDateFromUnixSeconds(unixSeconds: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(unixSeconds * 1000));
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

    const dayVolume = positiveNumber(row.day?.v)
      ? row.day.v
      : positiveNumber(row.min?.av)
        ? row.min.av
        : positiveNumber(row.min?.v)
          ? row.min.v
          : 0;
    const dollarVolume = dayVolume * priceNow;
    if (dayVolume < opts.minDayVolume) continue;

    candidates.push({
      ticker,
      change,
      changePct,
      priceNow,
      dayVolume,
      dollarVolume,
      updated: row.updated,
    });
  }

  return candidates
    .sort((a, b) => b.changePct - a.changePct || b.dayVolume - a.dayVolume)
    .slice(0, opts.snapshotPool);
}

async function fetchReference(ticker: string): Promise<ReferenceResult | null> {
  try {
    const data = await polygonGet<{ results?: ReferenceResult }>(
      `/v3/reference/tickers/${encodeURIComponent(ticker)}`,
    );
    return data.results ?? null;
  } catch {
    return null;
  }
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
      if (!positiveNumber(priceNow)) continue;

      const prevClose = row?.prevDay?.c;
      const change = positiveNumber(prevClose) ? priceNow - prevClose : 0;
      const changePct = positiveNumber(prevClose) ? (change / prevClose) * 100 : 0;
      const dayVolume = positiveNumber(row?.day?.v)
        ? row.day.v
        : positiveNumber(row?.min?.av)
          ? row.min.av
          : positiveNumber(row?.min?.v)
            ? row.min.v
            : 0;
      const ref = refs[j];

      result.set(ticker, {
        ticker,
        change,
        changePct,
        priceNow,
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
): Promise<RvolScannerHit | null> {
  const bars = await fetchBarsForSignalScan(candidate.ticker, etDate, resolution);
  if (bars.length === 0) return null;

  const breakoutMode = breakoutModeForResolution(resolution);
  const indicator = rossCameronMomentum(bars, {
    rvolLookback: rvolLookbackForResolution(resolution),
    breakoutMode,
    maxPrice,
  });

  const entryIndex = indicator.entries.findIndex((entry, index) =>
    entry && etDateFromUnixSeconds(bars[index].time) === etDate && etMinutes(bars[index].time) >= SIGNAL_START_MINUTES_ET,
  );
  if (entryIndex === -1) return null;

  const signalBar = bars[entryIndex];
  return {
    ...candidate,
    resolution,
    signalTimeEt: formatEtTime(signalBar.time),
    signalUnixSeconds: signalBar.time,
    signalPrice: signalBar.close,
    signalRvol: indicator.rvol[entryIndex],
    breakoutLevel: indicator.breakoutLevel[entryIndex],
    breakoutMode,
    barsScanned: bars.length,
  };
}

export async function scanRvolBuySignals(
  options: RvolScannerOptions = {},
): Promise<RvolScannerResult> {
  const etDate = options.etDate ?? mostRecentTradingDay();
  const resolution = options.resolution ?? "1m";
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
  const hits: RvolScannerHit[] = [];

  for (let i = 0; i < candidates.length; i += BAR_BATCH_SIZE) {
    const batch = candidates.slice(i, i + BAR_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const batchHits = await Promise.all(
      batch.map((candidate) =>
        scanCandidate(candidate, etDate, resolution, maxPrice).catch(() => null),
      ),
    );
    for (const hit of batchHits) {
      if (hit) hits.push(hit);
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
  };
}
