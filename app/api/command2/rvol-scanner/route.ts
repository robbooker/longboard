import { NextResponse } from "next/server";
import { scanRvolBuySignals } from "@/lib/scanners/rvolScanner";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function numberParam(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date");
  const etDate = rawDate && DATE_PATTERN.test(rawDate) ? rawDate : mostRecentTradingDay();

  try {
    const result = await scanRvolBuySignals({
      etDate,
      snapshotPool: numberParam(url.searchParams.get("pool"), 120, 20, 250),
      candidateLimit: numberParam(url.searchParams.get("limit"), 40, 5, 80),
      minPrice: numberParam(url.searchParams.get("minPrice"), 1, 1, 100),
      minMovePct: numberParam(url.searchParams.get("minMovePct"), 5, 0, 100),
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scanner error.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
