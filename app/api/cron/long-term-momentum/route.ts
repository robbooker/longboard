import { NextRequest, NextResponse } from "next/server";
import { scanRvolBuySignals } from "@/lib/scanners/rvolScanner";
import {
  LONG_TERM_MOMENTUM_RESOLUTIONS,
  LONG_TERM_MOMENTUM_SCANNER_KEY,
  persistLongTermMomentumHits,
  readLongTermMomentumCursor,
  recordLongTermMomentumScanRun,
  writeLongTermMomentumCursor,
} from "@/lib/scanners/longTermMomentumCache";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NASDAQ_PRIMARY_EXCHANGE = "XNAS";
const DEFAULT_SNAPSHOT_POOL = 20_000;
const DEFAULT_CANDIDATE_LIMIT = 80;

function authorizeCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

function numberParam(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(req: NextRequest) {
  const unauthorized = authorizeCron(req);
  if (unauthorized) return unauthorized;

  const params = req.nextUrl.searchParams;
  const rawDate = params.get("date");
  const etDate = rawDate && DATE_PATTERN.test(rawDate) ? rawDate : mostRecentTradingDay();
  const scannerKey = params.get("key")?.trim() || LONG_TERM_MOMENTUM_SCANNER_KEY;
  const snapshotPool = numberParam(
    params.get("pool"),
    envNumber("LONG_TERM_MOMENTUM_SNAPSHOT_POOL", DEFAULT_SNAPSHOT_POOL),
    100,
    20_000,
  );
  const candidateLimit = numberParam(
    params.get("limit"),
    envNumber("LONG_TERM_MOMENTUM_CANDIDATE_LIMIT", DEFAULT_CANDIDATE_LIMIT),
    5,
    250,
  );
  const explicitOffset = params.get("offset");
  const candidateOffset = explicitOffset
    ? numberParam(explicitOffset, 0, 0, 20_000)
    : await readLongTermMomentumCursor(scannerKey);
  const scannerOptions = {
    etDate,
    snapshotPool,
    candidateLimit,
    candidateOffset,
    minPrice: 1,
    minMovePct: 0,
    minDayVolume: 0,
    maxPrice: null,
    primaryExchanges: [NASDAQ_PRIMARY_EXCHANGE],
  };

  try {
    const scanResults = await Promise.all(
      LONG_TERM_MOMENTUM_RESOLUTIONS.map((resolution) =>
        scanRvolBuySignals({ ...scannerOptions, resolution }),
      ),
    );
    const combinedHits = scanResults.flatMap((scan) => scan.hits);
    const persisted = await persistLongTermMomentumHits(combinedHits, etDate);
    const rawCandidateCount = Math.max(...scanResults.map((scan) => scan.universe.rawCandidateCount), 0);
    const nextCandidateOffset =
      rawCandidateCount > 0 && candidateOffset + candidateLimit < rawCandidateCount
        ? candidateOffset + candidateLimit
        : 0;

    if (!explicitOffset) {
      await writeLongTermMomentumCursor(nextCandidateOffset, scannerKey);
    }

    const scans = scanResults.map((scan) => ({
      resolution: scan.resolution,
      scanned: scan.scanned,
      signals: scan.hits.length,
    }));
    await recordLongTermMomentumScanRun({
      scannerKey,
      status: "ok",
      etDate,
      candidateOffset,
      nextCandidateOffset,
      snapshotPool,
      candidateLimit,
      minPrice: 1,
      minMovePct: 0,
      maxPrice: null,
      primaryExchanges: [NASDAQ_PRIMARY_EXCHANGE],
      scanned: scanResults.reduce((sum, scan) => sum + scan.scanned, 0),
      signals: combinedHits.length,
      scans,
    });

    return NextResponse.json({
      status: "ok",
      etDate,
      scannerKey,
      universe: {
        snapshotPool,
        candidateLimit,
        candidateOffset,
        nextCandidateOffset,
        rawCandidateCount,
        minPrice: 1,
        minMovePct: 0,
        maxPrice: null,
        primaryExchanges: [NASDAQ_PRIMARY_EXCHANGE],
      },
      scanned: scanResults.reduce((sum, scan) => sum + scan.scanned, 0),
      signals: combinedHits.length,
      persisted,
      scans,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "long_term_momentum_cron_failed";
    await recordLongTermMomentumScanRun({
      scannerKey,
      status: "failed",
      etDate,
      candidateOffset,
      nextCandidateOffset: candidateOffset,
      snapshotPool,
      candidateLimit,
      minPrice: 1,
      minMovePct: 0,
      maxPrice: null,
      primaryExchanges: [NASDAQ_PRIMARY_EXCHANGE],
      scanned: 0,
      signals: 0,
      error: message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
