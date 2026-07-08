import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchCurrentRvolSnapshotCandidates,
  scanRvolBuySignals,
  type RvolScannerHit,
} from "@/lib/scanners/rvolScanner";
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
type IntradaySignalResolution = (typeof INTRADAY_SIGNAL_RESOLUTIONS)[number];
type AlertHistoryRow = {
  ticker: string;
  signal_resolution?: IntradaySignalResolution | null;
  signal_unix_seconds: number | string;
  signal_time_et: string;
  signal_rvol: number | string;
  signal_price: number | string;
  change_pct: number | string;
};

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

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intradayResolution(value: unknown): IntradaySignalResolution {
  return value === "5m" ? "5m" : "1m";
}

function alertHitKey(hit: Pick<RvolScannerHit, "resolution" | "ticker" | "signalUnixSeconds">) {
  return `${hit.resolution}:${hit.ticker}:${hit.signalUnixSeconds}`;
}

async function fetchTodayAlertHits(
  etDate: string,
  resolution: SignalResolutionFilter,
): Promise<RvolScannerHit[]> {
  if (resolution !== "all" && !INTRADAY_SIGNAL_RESOLUTIONS.includes(resolution as IntradaySignalResolution)) {
    return [];
  }

  const admin = createAdminClient();
  if (!admin) return [];

  let query = admin
    .from("rvol_alert_dispatches")
    .select("ticker,signal_resolution,signal_unix_seconds,signal_time_et,signal_rvol,signal_price,change_pct")
    .eq("et_date", etDate)
    .order("signal_unix_seconds", { ascending: false })
    .order("ticker", { ascending: true })
    .limit(500);

  if (resolution !== "all") query = query.eq("signal_resolution", resolution);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as AlertHistoryRow[];
  const currentByTicker = await fetchCurrentRvolSnapshotCandidates(rows.map((row) => row.ticker));
  const hits: RvolScannerHit[] = [];

  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase();
    const signalUnixSeconds = numberValue(row.signal_unix_seconds);
    const signalPrice = numberValue(row.signal_price);
    const signalRvol = numberValue(row.signal_rvol);
    if (!ticker || !signalUnixSeconds || !signalPrice || !signalRvol) continue;

    const current = currentByTicker.get(ticker);
    const changePct = current?.changePct ?? numberValue(row.change_pct) ?? 0;
    const priceNow = current?.priceNow ?? signalPrice;
    const dayVolume = current?.dayVolume ?? 0;

    hits.push({
      ticker,
      change: current?.change ?? 0,
      changePct,
      priceNow,
      dayVolume,
      dollarVolume: current?.dollarVolume ?? dayVolume * priceNow,
      updated: current?.updated,
      name: current?.name ?? null,
      referenceType: current?.referenceType ?? null,
      primaryExchange: current?.primaryExchange ?? null,
      resolution: intradayResolution(row.signal_resolution),
      signalTimeEt: row.signal_time_et,
      signalUnixSeconds,
      signalPrice,
      signalRvol,
      breakoutLevel: 0,
      breakoutMode: "premarketHigh",
      barsScanned: 0,
    });
  }

  return hits;
}

function mergeAlertHistoryWithLiveHits(
  liveHits: RvolScannerHit[],
  todayAlertHits: RvolScannerHit[],
): RvolScannerHit[] {
  const bySignal = new Map<string, RvolScannerHit>();
  for (const hit of todayAlertHits) {
    bySignal.set(alertHitKey(hit), hit);
  }
  for (const hit of liveHits) {
    bySignal.set(alertHitKey(hit), hit);
  }
  return Array.from(bySignal.values()).sort((a, b) =>
    b.signalUnixSeconds - a.signalUnixSeconds ||
    b.changePct - a.changePct ||
    a.resolution.localeCompare(b.resolution) ||
    a.ticker.localeCompare(b.ticker),
  );
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
      const todayAlertHits = isLongTerm ? [] : await fetchTodayAlertHits(etDate, resolution);
      const mergedHits = isLongTerm
        ? scan.hits
        : mergeAlertHistoryWithLiveHits(scan.hits, todayAlertHits);
      const hits = await enrichHitsWithCachedMonthlyPivots(mergedHits, etDate);

      return NextResponse.json(
        {
          ...scan,
          fetchedAt: new Date().toISOString(),
          mode,
          hits,
          liveSignalCount: scan.hits.length,
          todayAlertCount: todayAlertHits.length,
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
    const todayAlertHits = isLongTerm ? [] : await fetchTodayAlertHits(etDate, resolution);
    const combinedHits = isLongTerm
      ? combinedLiveHits
      : mergeAlertHistoryWithLiveHits(combinedLiveHits, todayAlertHits);
    const hits = await enrichHitsWithCachedMonthlyPivots(combinedHits, etDate);
    const result = {
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
