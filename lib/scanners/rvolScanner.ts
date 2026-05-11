import { rossCameronMomentum, rvolLookbackForResolution } from "@/lib/indicators";
import { fetchBarsForDay } from "@/lib/polygon/bars";
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
  min?: { c?: number; v?: number };
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
};

export type RvolScannerHit = RvolScannerCandidate & {
  signalTimeEt: string;
  signalUnixSeconds: number;
  signalPrice: number;
  signalRvol: number;
  barsScanned: number;
};

export type RvolScannerResult = {
  etDate: string;
  fetchedAt: string;
  source: "polygon";
  universe: {
    snapshotPool: number;
    candidateLimit: number;
    minPrice: number;
    minMovePct: number;
  };
  scanned: number;
  hits: RvolScannerHit[];
  candidates: RvolScannerCandidate[];
};

export type RvolScannerOptions = {
  etDate?: string;
  snapshotPool?: number;
  candidateLimit?: number;
  minPrice?: number;
  minMovePct?: number;
};

const DEFAULT_SNAPSHOT_POOL = 120;
const DEFAULT_CANDIDATE_LIMIT = 40;
const DEFAULT_MIN_PRICE = 1;
const DEFAULT_MIN_MOVE_PCT = 5;
const REFERENCE_BATCH_SIZE = 8;
const BAR_BATCH_SIZE = 5;

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

function isCommonOperatingStock(ref: ReferenceResult | null): boolean {
  if (!ref || ref.active === false) return false;
  const type = ref.type?.toUpperCase() ?? "";
  const market = ref.market?.toLowerCase() ?? "";
  if (market && market !== "stocks") return false;
  if (type !== "CS") return false;
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

function toSnapshotCandidates(
  rows: RawSnapshotTicker[],
  opts: { minPrice: number; minMovePct: number; snapshotPool: number },
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

    const dayVolume = positiveNumber(row.day?.v) ? row.day.v : positiveNumber(row.min?.v) ? row.min.v : 0;
    const dollarVolume = dayVolume * priceNow;
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
    .sort((a, b) => b.changePct - a.changePct || b.dollarVolume - a.dollarVolume)
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
): Promise<RvolScannerCandidate[]> {
  const kept: RvolScannerCandidate[] = [];

  for (let i = 0; i < candidates.length && kept.length < limit; i += REFERENCE_BATCH_SIZE) {
    const batch = candidates.slice(i, i + REFERENCE_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const refs = await Promise.all(batch.map((candidate) => fetchReference(candidate.ticker)));
    for (let j = 0; j < batch.length; j++) {
      const ref = refs[j];
      if (!isCommonOperatingStock(ref)) continue;
      kept.push({
        ...batch[j],
        name: ref?.name?.trim() || null,
        referenceType: ref?.type ?? null,
      });
      if (kept.length >= limit) break;
    }
  }

  return kept;
}

async function scanCandidate(
  candidate: RvolScannerCandidate,
  etDate: string,
): Promise<RvolScannerHit | null> {
  const bars = await fetchBarsForDay(candidate.ticker, etDate, "1m");
  if (bars.length === 0) return null;

  const indicator = rossCameronMomentum(bars, {
    rvolLookback: rvolLookbackForResolution("1m"),
  });

  const entryIndex = indicator.entries.findIndex(Boolean);
  if (entryIndex === -1) return null;

  const signalBar = bars[entryIndex];
  return {
    ...candidate,
    signalTimeEt: formatEtTime(signalBar.time),
    signalUnixSeconds: signalBar.time,
    signalPrice: signalBar.close,
    signalRvol: indicator.rvol[entryIndex],
    barsScanned: bars.length,
  };
}

export async function scanRvolBuySignals(
  options: RvolScannerOptions = {},
): Promise<RvolScannerResult> {
  const etDate = options.etDate ?? mostRecentTradingDay();
  const snapshotPool = options.snapshotPool ?? DEFAULT_SNAPSHOT_POOL;
  const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const minPrice = options.minPrice ?? DEFAULT_MIN_PRICE;
  const minMovePct = options.minMovePct ?? DEFAULT_MIN_MOVE_PCT;

  const snapshot = await polygonGet<{ tickers?: RawSnapshotTicker[] }>(
    "/v2/snapshot/locale/us/markets/stocks/tickers",
  );
  const rawCandidates = toSnapshotCandidates(snapshot.tickers ?? [], {
    minPrice,
    minMovePct,
    snapshotPool,
  });
  const candidates = await filterReferenceCandidates(rawCandidates, candidateLimit);
  const hits: RvolScannerHit[] = [];

  for (let i = 0; i < candidates.length; i += BAR_BATCH_SIZE) {
    const batch = candidates.slice(i, i + BAR_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const batchHits = await Promise.all(
      batch.map((candidate) =>
        scanCandidate(candidate, etDate).catch(() => null),
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
    universe: {
      snapshotPool,
      candidateLimit,
      minPrice,
      minMovePct,
    },
    scanned: candidates.length,
    hits,
    candidates,
  };
}
