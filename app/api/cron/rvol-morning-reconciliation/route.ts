import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchBarsForDay, fetchDailyBarsEndingOn } from "@/lib/polygon/bars";
import {
  buildReconciledDispatchRow,
  previousWeekdayEtDate,
  reconciledAlertKey,
  type QualifiedRvolDiagnostic,
} from "@/lib/scanners/rvolMorningReconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ExistingDispatch = { alert_key: string; ticker: string };

function authorizeCron(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

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
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const targetDate = previousWeekdayEtDate();
  try {
    const admin = createAdminClient();
    const [
      { data: diagnosticData, error: diagnosticError },
      { count: diagnosticCount, error: diagnosticCountError },
      { data: existingData, error: existingError },
    ] = await Promise.all([
      admin
        .from("rvol_scan_diagnostics")
        .select("et_date,ticker,best_bar_unix_seconds,best_bar_time_et,signal_rvol,breakout_level,breakout_mode,rvol_method")
        .eq("et_date", targetDate)
        .eq("signal_resolution", "5m")
        .eq("qualified", true)
        .order("best_bar_unix_seconds", { ascending: true })
        .limit(1_000),
      admin
        .from("rvol_scan_diagnostics")
        .select("ticker", { count: "exact", head: true })
        .eq("et_date", targetDate)
        .eq("signal_resolution", "5m"),
      admin
        .from("rvol_alert_dispatches")
        .select("alert_key,ticker")
        .eq("et_date", targetDate)
        .eq("signal_resolution", "5m")
        .limit(1_000),
    ]);
    if (diagnosticError) throw diagnosticError;
    if (diagnosticCountError) throw diagnosticCountError;
    if (existingError) throw existingError;

    const diagnostics = (diagnosticData ?? []) as QualifiedRvolDiagnostic[];
    const existing = (existingData ?? []) as ExistingDispatch[];
    if ((diagnosticCount ?? 0) === 0 && existing.length === 0) {
      const marketBars = await fetchBarsForDay("SPY", targetDate, "5m");
      if (marketBars.length === 0) {
        return NextResponse.json({
          status: "market_closed",
          targetDate,
          scannerDiagnostics: 0,
          qualifiedDiagnostics: 0,
          previouslySaved: 0,
          restored: 0,
          finalSaved: 0,
          failures: [],
        }, { headers: { "cache-control": "no-store" } });
      }
      return NextResponse.json({
        status: "failed",
        targetDate,
        scannerDiagnostics: 0,
        qualifiedDiagnostics: 0,
        previouslySaved: 0,
        restored: 0,
        finalSaved: 0,
        failures: ["The market traded, but no 5-minute scanner diagnostics were saved."],
      }, { status: 500, headers: { "cache-control": "no-store" } });
    }
    const existingTickers = new Set(existing.map((row) => row.ticker.trim().toUpperCase()));
    const missing = diagnostics.filter((row) => {
      const key = reconciledAlertKey(row);
      return key != null && !existingTickers.has(row.ticker.trim().toUpperCase());
    });

    const restored = await mapWithConcurrency(missing, 5, async (diagnostic) => {
      try {
        const [intradayBars, dailyBars] = await Promise.all([
          fetchBarsForDay(diagnostic.ticker, targetDate, "5m"),
          fetchDailyBarsEndingOn(diagnostic.ticker, targetDate),
        ]);
        const row = buildReconciledDispatchRow(diagnostic, intradayBars, dailyBars);
        return row ? { row, failure: null } : { row: null, failure: `${diagnostic.ticker}: incomplete Polygon bars` };
      } catch (error) {
        return {
          row: null,
          failure: `${diagnostic.ticker}: ${error instanceof Error ? error.message : "reconstruction failed"}`,
        };
      }
    });
    const rows = restored.flatMap((item) => item.row ? [item.row] : []);
    const failures = restored.flatMap((item) => item.failure ? [item.failure] : []);

    if (rows.length > 0) {
      const { error: insertError } = await admin
        .from("rvol_alert_dispatches")
        .upsert(rows, { onConflict: "alert_key", ignoreDuplicates: true });
      if (insertError) throw insertError;
    }

    const { count: finalCount, error: countError } = await admin
      .from("rvol_alert_dispatches")
      .select("alert_key", { count: "exact", head: true })
      .eq("et_date", targetDate)
      .eq("signal_resolution", "5m");
    if (countError) throw countError;

    const status = failures.length > 0 ? "partial" : rows.length > 0 ? "restored" : "complete";
    return NextResponse.json({
      status,
      targetDate,
      scannerDiagnostics: diagnosticCount ?? 0,
      qualifiedDiagnostics: diagnostics.length,
      previouslySaved: existing.length,
      restored: rows.length,
      finalSaved: finalCount ?? existing.length + rows.length,
      failures,
      reportUrl: `/scanner/this-week-in-longing?start=${targetDate}&end=${targetDate}`,
    }, {
      status: failures.length > 0 ? 500 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      status: "failed",
      targetDate,
      error: error instanceof Error ? error.message : "rvol_morning_reconciliation_failed",
    }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
