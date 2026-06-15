import { NextResponse } from "next/server";
import { fetchChartBarsWithCache } from "@/lib/charts/chartBarsCache";
import { CHART_RESOLUTIONS, fetchBarsForDay, fetchBarsForLookback, type Resolution } from "@/lib/polygon/bars";
import {
  rossCameronMomentum,
  rvolLookbackForResolution,
} from "@/lib/indicators";
import { computeSessionBoundaries } from "@/lib/time/sessionBoundaries";
import { mostRecentTradingDay } from "@/lib/time/mostRecentTradingDay";
import { fetchGhostPivot } from "@/lib/charts/ghostPivot";

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

function lookbackDaysForResolution(resolution: Resolution): number {
  return LONG_TERM_LOOKBACK_DAYS[resolution] ?? 0;
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
  const latestEtDate = mostRecentTradingDay();
  const etDate = sanitizeDate(url.searchParams.get("date")) ?? latestEtDate;

  if (!ticker) {
    return NextResponse.json(
      { error: "Invalid ticker." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const [chartData, ghostPivot] = await Promise.all([
      fetchChartBarsWithCache({
        ticker,
        etDate,
        latestEtDate,
        resolution,
        lookbackDays: lookbackDaysForResolution(resolution),
        fetchLive: () => fetchChartBars(ticker, etDate, resolution),
      }),
      fetchGhostPivot(ticker, etDate),
    ]);
    const indicator = rossCameronMomentum(chartData.bars, {
      rvolLookback: rvolLookbackForResolution(resolution),
      breakoutMode: breakoutModeForResolution(resolution),
    });
    return NextResponse.json(
      {
        ticker,
        etDate,
        resolution,
        bars: chartData.bars,
        indicator,
        ghostPivot,
        sessions: resolution === "1d" ? [] : computeSessionBoundaries(etDate),
        fetchedAt: chartData.fetchedAt,
        source: chartData.source,
        cache: chartData.cache,
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
