import { NextResponse, after } from "next/server";
import { scanRvolBuySignalsForResolutions } from "@/lib/scanners/rvolScanner";
import {
  fetchCachedLongTermMomentumSignals,
  longTermCachePayload,
  persistLongTermMomentumHits,
} from "@/lib/scanners/longTermMomentumCache";
import { enrichHitsWithCachedMonthlyPivots } from "@/lib/scanners/monthlyPivotCache";
import {
  fetchTodayAlertHitsForView,
  intradayPayload,
  MONTHLY_PIVOTS_META,
  mergeAlertHistoryWithLiveHits,
  readIntradayBundle,
  sharedResponse,
} from "@/lib/scanners/rvolScannerFeed";
import type { IntradayResolution } from "@/lib/polygon/bars";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCANNER_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=60";
const NO_STORE = "no-store";
const INTRADAY_SIGNAL_RESOLUTIONS = ["1m", "5m"] as const satisfies readonly IntradayResolution[];
const LONG_TERM_SIGNAL_RESOLUTIONS = ["1h", "4h"] as const satisfies readonly IntradayResolution[];
const NASDAQ_PRIMARY_EXCHANGE = "XNAS";
const DEFAULT_INTRADAY_CANDIDATE_LIMIT = 40;
type ScannerMode = "intraday" | "longTerm";
type SignalResolutionFilter = IntradayResolution | "all";
type IntradaySignalResolution = (typeof INTRADAY_SIGNAL_RESOLUTIONS)[number];

function numberParam(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function modeParam(value: string | null): ScannerMode {
  if (value === "longTerm" || value === "long-term" || value === "long_term") return "longTerm";
  return "intraday";
}

function resolutionsForMode(mode: ScannerMode): readonly IntradayResolution[] {
  return mode === "longTerm" ? LONG_TERM_SIGNAL_RESOLUTIONS : INTRADAY_SIGNAL_RESOLUTIONS;
}

function resolutionParam(value: string | null, mode: ScannerMode): SignalResolutionFilter {
  const allowed = resolutionsForMode(mode);
  if (value === "all") return value;
  if (value && (allowed as readonly string[]).includes(value)) return value as IntradayResolution;
  return "all";
}

type ScannerOptions = {
  etDate: string;
  snapshotPool: number;
  candidateLimit: number;
  candidateOffset: number;
  minPrice: number;
  minMovePct: number;
  minDayVolume: number;
  maxPrice: number | null;
  primaryExchanges: string[] | undefined;
};

// Computes a scanner response the original way. Used for long-term mode and for non-default
// filters/dates (behind a shared copy unless the caller asked for a live scan); the default
// intraday view is served from the shared bundle instead.
async function computeScannerPayload(
  mode: ScannerMode,
  resolution: SignalResolutionFilter,
  scannerOptions: ScannerOptions,
  readLongTermCache: boolean,
): Promise<Record<string, unknown>> {
  const { etDate } = scannerOptions;
  const isLongTerm = mode === "longTerm";

  if (readLongTermCache) {
    const cached = await fetchCachedLongTermMomentumSignals({ etDate, resolution });
    if (cached.available && cached.hits.length > 0) {
      const hits = await enrichHitsWithCachedMonthlyPivots(cached.hits, etDate);
      return {
        ...longTermCachePayload({
          etDate,
          resolution,
          hits,
          scannerOptions: {
            snapshotPool: scannerOptions.snapshotPool,
            candidateLimit: scannerOptions.candidateLimit,
            candidateOffset: scannerOptions.candidateOffset,
            rawCandidateCount: 0,
            minPrice: scannerOptions.minPrice,
            minMovePct: scannerOptions.minMovePct,
            minDayVolume: scannerOptions.minDayVolume,
            maxPrice: scannerOptions.maxPrice,
            primaryExchanges: scannerOptions.primaryExchanges ?? null,
          },
        }),
        mode,
        monthlyPivots: MONTHLY_PIVOTS_META,
      };
    }
  }

  const resolutions = resolution === "all" ? resolutionsForMode(mode) : [resolution];
  // One market snapshot shared by the resolutions (same result as separate scans).
  const scans = await scanRvolBuySignalsForResolutions(resolutions, scannerOptions);

  if (resolution !== "all") {
    const [scan] = scans;
    if (isLongTerm) {
      await persistLongTermMomentumHits(scan.hits, etDate);
    }
    const todayAlertHits = isLongTerm ? [] : await fetchTodayAlertHitsForView(etDate, resolution as IntradaySignalResolution);
    const mergedHits = isLongTerm
      ? scan.hits
      : mergeAlertHistoryWithLiveHits(scan.hits, todayAlertHits);
    const hits = await enrichHitsWithCachedMonthlyPivots(mergedHits, etDate);
    return {
      ...scan,
      fetchedAt: new Date().toISOString(),
      mode,
      hits,
      liveSignalCount: scan.hits.length,
      todayAlertCount: todayAlertHits.length,
      monthlyPivots: MONTHLY_PIVOTS_META,
    };
  }

  const [firstScan] = scans;
  const combinedLiveHits = scans
    .flatMap((scan) => scan.hits)
    .sort((a, b) =>
      b.changePct - a.changePct ||
      a.signalUnixSeconds - b.signalUnixSeconds ||
      a.resolution.localeCompare(b.resolution) ||
      a.ticker.localeCompare(b.ticker),
    );
  if (isLongTerm) {
    await persistLongTermMomentumHits(combinedLiveHits, etDate);
  }
  const todayAlertHits = isLongTerm ? [] : await fetchTodayAlertHitsForView(etDate, "all");
  const combinedHits = isLongTerm
    ? combinedLiveHits
    : mergeAlertHistoryWithLiveHits(combinedLiveHits, todayAlertHits);
  const hits = await enrichHitsWithCachedMonthlyPivots(combinedHits, etDate);
  return {
    ...firstScan,
    fetchedAt: new Date().toISOString(),
    mode,
    resolution,
    scanned: Math.max(...scans.map((scan) => scan.scanned)),
    hits,
    liveSignalCount: combinedLiveHits.length,
    todayAlertCount: todayAlertHits.length,
    scans: scans.map((scan) => ({
      resolution: scan.resolution,
      scanned: scan.scanned,
      signals: scan.hits.length,
    })),
    monthlyPivots: MONTHLY_PIVOTS_META,
  };
}

function usesDefaultIntradayScan(mode: ScannerMode, options: ScannerOptions): boolean {
  return (
    mode === "intraday" &&
    options.etDate === mostRecentTradingDay() &&
    options.snapshotPool === 120 &&
    options.candidateLimit <= DEFAULT_INTRADAY_CANDIDATE_LIMIT &&
    options.candidateOffset === 0 &&
    options.minPrice === 1 &&
    options.minMovePct === 5 &&
    options.minDayVolume === 100_000 &&
    options.maxPrice === 20 &&
    !options.primaryExchanges
  );
}

function json(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": SCANNER_CACHE_CONTROL } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date");
  const etDate = rawDate && DATE_PATTERN.test(rawDate) ? rawDate : mostRecentTradingDay();
  const mode = modeParam(url.searchParams.get("mode"));
  const resolution = resolutionParam(url.searchParams.get("resolution") ?? url.searchParams.get("res"), mode);
  const isLongTerm = mode === "longTerm";
  const source = url.searchParams.get("source");
  const liveRequested = source === "live" || url.searchParams.get("refresh") === "1";
  const readLongTermCache = isLongTerm && !liveRequested;
  // The page's refresh button: recompute the shared copy if it is older than 15 s.
  const force = url.searchParams.get("force") === "1";
  const candidateOffset = numberParam(url.searchParams.get("offset"), 0, 0, 20_000);
  const scannerOptions: ScannerOptions = {
    etDate,
    snapshotPool: numberParam(url.searchParams.get("pool"), isLongTerm ? 250 : 120, 20, isLongTerm ? 1000 : 250),
    candidateLimit: numberParam(url.searchParams.get("limit"), isLongTerm ? 40 : 40, 5, isLongTerm ? 250 : 80),
    candidateOffset: isLongTerm ? candidateOffset : 0,
    minPrice: numberParam(url.searchParams.get("minPrice"), 1, 1, 100),
    minMovePct: numberParam(url.searchParams.get("minMovePct"), isLongTerm ? 0 : 5, 0, 100),
    minDayVolume: numberParam(url.searchParams.get("minDayVolume"), isLongTerm ? 0 : 100_000, 0, 100_000_000),
    maxPrice: isLongTerm ? null : 20,
    primaryExchanges: isLongTerm ? [NASDAQ_PRIMARY_EXCHANGE] : undefined,
  };

  try {
    if (usesDefaultIntradayScan(mode, scannerOptions)) {
      const { entry, refreshInBackground } = await readIntradayBundle(etDate, { force });
      if (refreshInBackground) {
        after(() => refreshInBackground().catch((error) => {
          console.error("rvol_scanner_background_refresh_failed", error instanceof Error ? error.message : error);
        }));
      }
      return json(intradayPayload(entry.value, resolution as IntradaySignalResolution | "all", scannerOptions.candidateLimit));
    }

    const compute = () => computeScannerPayload(mode, resolution, scannerOptions, readLongTermCache);
    if (liveRequested) return json(await compute());

    const key = JSON.stringify({ mode, resolution, ...scannerOptions });
    const { value } = await sharedResponse(key, compute, { force });
    return json(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scanner error.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": NO_STORE } },
    );
  }
}
