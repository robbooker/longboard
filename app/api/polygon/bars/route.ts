import { NextRequest, NextResponse } from "next/server";
import { fetchBarsForDay, type Resolution } from "@/lib/polygon/bars";
import { computeSessionBoundaries } from "@/lib/time/sessionBoundaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,5}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RESOLUTIONS: readonly Resolution[] = ["1m", "5m"] as const;

function sanitizeTicker(input: string | null): string | null {
  if (!input) return null;
  const upper = input.toUpperCase().trim();
  return TICKER_PATTERN.test(upper) ? upper : null;
}

function sanitizeDate(input: string | null): string | null {
  if (!input) return null;
  return DATE_PATTERN.test(input) ? input : null;
}

function sanitizeResolution(input: string | null): Resolution | null {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  return (RESOLUTIONS as readonly string[]).includes(lower)
    ? (lower as Resolution)
    : null;
}

export async function GET(req: NextRequest) {
  const ticker = sanitizeTicker(req.nextUrl.searchParams.get("ticker"));
  const date = sanitizeDate(req.nextUrl.searchParams.get("date"));
  const resolution = sanitizeResolution(req.nextUrl.searchParams.get("res")) ?? "1m";

  if (!ticker) {
    return NextResponse.json({ error: "invalid_ticker" }, { status: 400 });
  }
  if (!date) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  try {
    const bars = await fetchBarsForDay(ticker, date, resolution);
    return NextResponse.json({
      ticker,
      date,
      resolution,
      bars,
      sessions: computeSessionBoundaries(date),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
