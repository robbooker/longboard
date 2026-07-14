import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateLongingSignal, summarizeLongingSignals, type StoredLongingSignal } from "@/lib/longing/calculate";
import { LongingReportRangeError, resolveLongingReportRange } from "@/lib/longing/range";
import type { LongingReport, LongingSignal } from "@/lib/longing/types";
import { fetchBarsForDay } from "@/lib/polygon/bars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function GET(request: NextRequest) {
  let range;
  try {
    range = resolveLongingReportRange({
      start: request.nextUrl.searchParams.get("start"),
      end: request.nextUrl.searchParams.get("end"),
      week: request.nextUrl.searchParams.get("week"),
    });
  } catch (error) {
    if (error instanceof LongingReportRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
  const weekStart = range.start;
  const weekEnd = range.end;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("rvol_alert_dispatches")
      .select("alert_key,et_date,ticker,signal_unix_seconds,signal_time_et,signal_rvol,signal_price,change_pct,signal_breakout_mode,rvol_method,signal_origin,status,error,created_at")
      .eq("signal_resolution", "5m")
      .gte("et_date", weekStart)
      .lte("et_date", weekEnd)
      .order("signal_unix_seconds", { ascending: true })
      .limit(2_000);
    if (error) throw error;

    const rows = (data ?? []) as StoredLongingSignal[];
    const groups = new Map<string, StoredLongingSignal[]>();
    for (const row of rows) {
      const key = `${row.et_date}:${row.ticker.trim().toUpperCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const analyzed = await mapWithConcurrency([...groups.values()], 8, async (group) => {
      try {
        const bars = await fetchBarsForDay(group[0].ticker, group[0].et_date, "5m");
        return group.map((row) => calculateLongingSignal(row, bars)).filter((row): row is LongingSignal => row != null);
      } catch {
        return group.map((row) => calculateLongingSignal(row, [])).filter((row): row is LongingSignal => row != null);
      }
    });
    const signals = analyzed.flat().sort((a, b) => b.dayVolume - a.dayVolume || a.signalUnixSeconds - b.signalUnixSeconds);
    const actionable = signals.filter((row) => !row.stale);

    const report: LongingReport = {
      generatedAt: new Date().toISOString(),
      weekStart,
      weekEnd,
      title: "This Week in Longing",
      source: "Longboard rvol_alert_dispatches + Polygon 5-minute consolidated bars",
      methodology: {
        positionSize: 1_000,
        volumeSession: "Total 5-minute bar volume from 4:00am through 8:00pm ET.",
        volumeAtSignal: "Cumulative 5-minute bar volume from 4:00am ET through and including the candle that produced the saved signal.",
        dayMoveBaseline: "8:00pm price versus the prior close implied by the saved signal price and saved day move.",
        entryAssumption: "Fractional shares bought at the saved signal-bar price; no slippage, fees, halts, or locate constraints.",
        targetRule: "A +20% target counts only when a later 5-minute bar trades at or above 1.20x the signal price. If missed, target-or-close exits at 8:00pm.",
        staleRule: "Rows detected more than 10 minutes after the saved signal bar, or explicitly marked older-than-limit, are excluded from the actionable cohort.",
      },
      summary: {
        all: summarizeLongingSignals(signals),
        actionable: summarizeLongingSignals(actionable),
        staleSignals: signals.length - actionable.length,
        uniqueTickers: new Set(signals.map((row) => row.ticker)).size,
        tradingDays: new Set(signals.map((row) => row.etDate)).size,
      },
      signals,
    };

    return NextResponse.json(report, {
      headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=3600" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "this_week_in_longing_failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
