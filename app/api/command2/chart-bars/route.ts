import { NextResponse } from "next/server";
import { CHART_RESOLUTIONS, fetchBarsForDay, fetchBarsForLookback, type Resolution } from "@/lib/polygon/bars";
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
const LONG_TERM_LOOKBACK_DAYS: Partial<Record<Resolution, number>> = {
  "1h": 45,
  "4h": 120,
};

function sanitizeTicker(input: string | null): string | null {
  if (!input) return null;
  const ticker = input.trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

function sanitizeResolution(input: string | null): Resolution | null {
  if (!input) return null;
  const resolution = input.trim().toLowerCase();
  return (CHART_RESOLUTIONS as readonly string[]).includes(resolution)
    ? (resolution as Resolution)
    : null;
}

function sanitizeDate(input: string | null): string | null {
  if (!input) return null;
  return DATE_PATTERN.test(input) ? input : null;
}

function breakoutModeForResolution(resolution: Resolution) {
  if (resolution === "1h") return "twoWeekHigh";
  if (resolution === "4h") return "monthToDateHigh";
  return "premarketHigh";
}

function fetchChartBars(ticker: string, etDate: string, resolution: Resolution) {
  const lookbackDays = LONG_TERM_LOOKBACK_DAYS[resolution];
  if (lookbackDays && resolution !== "1d") {
    return fetchBarsForLookback(ticker, etDate, resolution, lookbackDays);
  }
  return fetchBarsForDay(ticker, etDate, resolution);
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
    const bars = await fetchChartBars(ticker, etDate, resolution);
    const indicator = rossCameronMomentum(bars, {
      rvolLookback: rvolLookbackForResolution(resolution),
      breakoutMode: breakoutModeForResolution(resolution),
    });
    return NextResponse.json(
      {
        ticker,
        etDate,
        resolution,
        bars,
        indicator,
        sessions: resolution === "1d" ? [] : computeSessionBoundaries(etDate),
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
