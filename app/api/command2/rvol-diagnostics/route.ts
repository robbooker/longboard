import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const ticker = request.nextUrl.searchParams.get("ticker")?.trim().toUpperCase() ?? null;
  const resolution = request.nextUrl.searchParams.get("resolution");
  if (date && !DATE_PATTERN.test(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  if (ticker && !TICKER_PATTERN.test(ticker)) return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  if (resolution && !["1m", "5m", "1h", "4h"].includes(resolution)) {
    return NextResponse.json({ error: "Invalid resolution." }, { status: 400 });
  }

  try {
    let query = createAdminClient()
      .from("rvol_scan_diagnostics")
      .select("et_date,signal_resolution,ticker,evaluated_at,evaluation_source,qualified,breakout_mode,rvol_method,best_bar_unix_seconds,best_bar_time_et,rejection_reasons,conditions_passed,signal_rvol,breakout_level,cumulative_volume,cumulative_volume_pace,baseline_sessions")
      .order("evaluated_at", { ascending: false })
      .limit(500);
    if (date) query = query.eq("et_date", date);
    if (ticker) query = query.eq("ticker", ticker);
    if (resolution) query = query.eq("signal_resolution", resolution);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ generatedAt: new Date().toISOString(), count: data?.length ?? 0, diagnostics: data ?? [] }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "rvol_diagnostics_failed" }, {
      status: 500,
      headers: { "cache-control": "no-store" },
    });
  }
}
