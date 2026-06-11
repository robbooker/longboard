import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SignalResolution = "1m" | "5m";
type SignalStatus = "pending" | "sent" | "skipped" | "failed";

type RvolHistoryRow = {
  alert_key: string;
  et_date: string;
  ticker: string;
  signal_resolution?: SignalResolution | null;
  signal_unix_seconds: number;
  signal_time_et: string;
  signal_rvol: number | string;
  signal_price: number | string;
  change_pct: number | string;
  status: SignalStatus;
  created_at: string;
};

type RvolHistorySignal = {
  alert_key: string;
  et_date: string;
  ticker: string;
  signal_resolution: SignalResolution;
  signal_unix_seconds: number;
  signal_time_et: string;
  signal_at: string;
  signal_rvol: number | null;
  signal_price: number | null;
  change_pct: number | null;
  status: SignalStatus;
  created_at: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATES = 60;
const MAX_ROWS = 500;

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromUnixSeconds(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

function normalize(row: RvolHistoryRow): RvolHistorySignal {
  const signalUnixSeconds = Number(row.signal_unix_seconds);
  return {
    alert_key: row.alert_key,
    et_date: row.et_date,
    ticker: row.ticker,
    signal_resolution: row.signal_resolution ?? "1m",
    signal_unix_seconds: signalUnixSeconds,
    signal_time_et: row.signal_time_et,
    signal_at: isoFromUnixSeconds(signalUnixSeconds),
    signal_rvol: numberValue(row.signal_rvol),
    signal_price: numberValue(row.signal_price),
    change_pct: numberValue(row.change_pct),
    status: row.status,
    created_at: row.created_at,
  };
}

function statusParam(value: string | null): SignalStatus | "all" {
  if (value === "pending" || value === "sent" || value === "skipped" || value === "failed") {
    return value;
  }
  return "all";
}

function resolutionParam(value: string | null): SignalResolution | "all" {
  if (value === "1m" || value === "5m") return value;
  return "all";
}

function uniqueDates(rows: Array<{ et_date: string | null }>) {
  const seen = new Set<string>();
  const dates: string[] = [];
  for (const row of rows) {
    if (!row.et_date || seen.has(row.et_date)) continue;
    seen.add(row.et_date);
    dates.push(row.et_date);
    if (dates.length >= MAX_DATES) break;
  }
  return dates;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const requestedDate = params.get("date");
  const status = statusParam(params.get("status"));
  const resolution = resolutionParam(params.get("resolution") ?? params.get("res"));

  if (requestedDate && !DATE_PATTERN.test(requestedDate)) {
    return NextResponse.json(
      { error: "Invalid date. Use YYYY-MM-DD." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const admin = createAdminClient();
    const { data: dateRows, error: dateError } = await admin
      .from("rvol_alert_dispatches")
      .select("et_date")
      .order("et_date", { ascending: false })
      .order("signal_unix_seconds", { ascending: false })
      .limit(800);

    if (dateError) throw dateError;

    const availableDates = uniqueDates((dateRows ?? []) as Array<{ et_date: string | null }>);
    const etDate = requestedDate ?? availableDates[0] ?? null;

    if (!etDate) {
      return NextResponse.json(
        {
          generated_at: new Date().toISOString(),
          source: "longboard:rvol_alert_dispatches",
          et_date: null,
          available_dates: [],
          filters: { status, resolution },
          count: 0,
          signals: [],
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    let query = admin
      .from("rvol_alert_dispatches")
      .select(
        "alert_key,et_date,ticker,signal_resolution,signal_unix_seconds,signal_time_et,signal_rvol,signal_price,change_pct,status,created_at",
      )
      .eq("et_date", etDate)
      .order("signal_unix_seconds", { ascending: true })
      .order("ticker", { ascending: true })
      .limit(MAX_ROWS);

    if (status !== "all") query = query.eq("status", status);
    if (resolution !== "all") query = query.eq("signal_resolution", resolution);

    const { data, error } = await query;
    if (error) throw error;

    const signals = ((data ?? []) as RvolHistoryRow[]).map(normalize);

    return NextResponse.json(
      {
        generated_at: new Date().toISOString(),
        source: "longboard:rvol_alert_dispatches",
        et_date: etDate,
        available_dates: availableDates,
        filters: { status, resolution },
        count: signals.length,
        signals,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rvol_history_failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
