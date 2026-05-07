import { NextResponse } from "next/server";
import { fetchBarsForDay, type Resolution } from "@/lib/polygon/bars";
import {
  rossCameronMomentum,
  rvolLookbackForResolution,
} from "@/lib/indicators";
import { computeSessionBoundaries } from "@/lib/time/sessionBoundaries";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,5}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RESOLUTIONS: readonly Resolution[] = ["1m", "5m"] as const;

function sanitizeTicker(input: string | null): string | null {
  if (!input) return null;
  const ticker = input.trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

function sanitizeResolution(input: string | null): Resolution | null {
  if (!input) return null;
  const resolution = input.trim().toLowerCase();
  return (RESOLUTIONS as readonly string[]).includes(resolution)
    ? (resolution as Resolution)
    : null;
}

function sanitizeDate(input: string | null): string | null {
  if (!input) return null;
  return DATE_PATTERN.test(input) ? input : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = sanitizeTicker(url.searchParams.get("ticker"));
  const resolution = sanitizeResolution(url.searchParams.get("res")) ?? "1m";
  const etDate = sanitizeDate(url.searchParams.get("date")) ?? mostRecentTradingDay();

  if (!ticker) {
    return NextResponse.json(
      { error: "Invalid ticker." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const bars = await fetchBarsForDay(ticker, etDate, resolution);
    const indicator = rossCameronMomentum(bars, {
      rvolLookback: rvolLookbackForResolution(resolution),
    });
    return NextResponse.json(
      {
        ticker,
        etDate,
        resolution,
        bars,
        indicator,
        sessions: computeSessionBoundaries(etDate),
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown chart error.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
