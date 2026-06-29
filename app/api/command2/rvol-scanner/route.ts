import { NextResponse } from "next/server";
import { scanRvolBuySignals } from "@/lib/scanners/rvolScanner";
import {
  fetchCachedLongTermMomentumSignals,
  longTermCachePayload,
  persistLongTermMomentumHits,
} from "@/lib/scanners/longTermMomentumCache";
import { enrichHitsWithCachedMonthlyPivots } from "@/lib/scanners/monthlyPivotCache";
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
type ScannerMode = "intraday" | "longTerm";
type SignalResolutionFilter = IntradayResolution | "all";

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date");
  const etDate = rawDate && DATE_PATTERN.test(rawDate) ? rawDate : mostRecentTradingDay();
  const mode = modeParam(url.searchParams.get("mode"));
  const resolution = resolutionParam(url.searchParams.get("resolution") ?? url.searchParams.get("res"), mode);
  const isLongTerm = mode === "longTerm";
  const source = url.searchParams.get("source");
  const readLongTermCache = isLongTerm && source !== "live" && url.searchParams.get("refresh") !== "1";
  const candidateOffset = numberParam(url.searchParams.get("offset"), 0, 0, 20_000);
  const scannerOptions = {
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
    if (readLongTermCache) {
      const cached = await fetchCachedLongTermMomentumSignals({ etDate, resolution });
      if (cached.available && cached.hits.length > 0) {
        const hits = await enrichHitsWithCachedMonthlyPivots(cached.hits, etDate);
        return NextResponse.json(
          {
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
            monthlyPivots: {
              enabled: true,
              cached: true,
              lookbackMonths: 36,
            },
          },
          { headers: { "Cache-Control": SCANNER_CACHE_CONTROL } },
        );
      }
    }

    if (resolution !== "all") {
      const scan = await scanRvolBuySignals({ ...scannerOptions, resolution });
      if (isLongTerm) {
        await persistLongTermMomentumHits(scan.hits, etDate);
      }
      const hits = await enrichHitsWithCachedMonthlyPivots(scan.hits, etDate);

      return NextResponse.json(
        {
          ...scan,
          fetchedAt: new Date().toISOString(),
          mode,
          hits,
          monthlyPivots: {
            enabled: true,
            cached: true,
            lookbackMonths: 36,
          },
        },
        { headers: { "Cache-Control": SCANNER_CACHE_CONTROL } },
      );
    }

    const scans = await Promise.all(
      resolutionsForMode(mode).map((nextResolution) =>
        scanRvolBuySignals({ ...scannerOptions, resolution: nextResolution }),
      ),
    );
    const [firstScan] = scans;
    const combinedHits = scans
      .flatMap((scan) => scan.hits)
      .sort((a, b) =>
        b.changePct - a.changePct ||
        a.signalUnixSeconds - b.signalUnixSeconds ||
        a.resolution.localeCompare(b.resolution) ||
        a.ticker.localeCompare(b.ticker),
      );
    if (isLongTerm) {
      await persistLongTermMomentumHits(combinedHits, etDate);
    }
    const hits = await enrichHitsWithCachedMonthlyPivots(combinedHits, etDate);
    const result = {
      ...firstScan,
      fetchedAt: new Date().toISOString(),
      mode,
      resolution,
      scanned: Math.max(...scans.map((scan) => scan.scanned)),
      hits,
      scans: scans.map((scan) => ({
        resolution: scan.resolution,
        scanned: scan.scanned,
        signals: scan.hits.length,
      })),
      monthlyPivots: {
        enabled: true,
        cached: true,
        lookbackMonths: 36,
      },
    };

    return NextResponse.json(result, {
      headers: { "Cache-Control": SCANNER_CACHE_CONTROL },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scanner error.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": NO_STORE } },
    );
  }
}
