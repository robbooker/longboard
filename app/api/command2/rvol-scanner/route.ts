import { NextResponse } from "next/server";
import { scanRvolBuySignals } from "@/lib/scanners/rvolScanner";
import { enrichHitsWithCachedMonthlyPivots } from "@/lib/scanners/monthlyPivotCache";
import type { IntradayResolution } from "@/lib/polygon/bars";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCANNER_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=60";
const NO_STORE = "no-store";
const SIGNAL_RESOLUTIONS = ["1m", "5m"] as const satisfies readonly IntradayResolution[];
type SignalResolutionFilter = IntradayResolution | "all";

function numberParam(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function resolutionParam(value: string | null): SignalResolutionFilter {
  if (value === "1m" || value === "5m" || value === "all") return value;
  return "all";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date");
  const etDate = rawDate && DATE_PATTERN.test(rawDate) ? rawDate : mostRecentTradingDay();
  const resolution = resolutionParam(url.searchParams.get("resolution") ?? url.searchParams.get("res"));
  const scannerOptions = {
    etDate,
    snapshotPool: numberParam(url.searchParams.get("pool"), 120, 20, 250),
    candidateLimit: numberParam(url.searchParams.get("limit"), 40, 5, 80),
    minPrice: numberParam(url.searchParams.get("minPrice"), 1, 1, 100),
    minMovePct: numberParam(url.searchParams.get("minMovePct"), 5, 0, 100),
  };

  try {
    if (resolution !== "all") {
      const scan = await scanRvolBuySignals({ ...scannerOptions, resolution });
      const hits = await enrichHitsWithCachedMonthlyPivots(scan.hits, etDate);

      return NextResponse.json(
        {
          ...scan,
          fetchedAt: new Date().toISOString(),
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
      SIGNAL_RESOLUTIONS.map((nextResolution) =>
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
    const hits = await enrichHitsWithCachedMonthlyPivots(combinedHits, etDate);
    const result = {
      ...firstScan,
      fetchedAt: new Date().toISOString(),
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
