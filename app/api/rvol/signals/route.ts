import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RvolDispatchRow = {
  alert_key: string;
  et_date: string;
  ticker: string;
  signal_resolution?: "1m" | "5m" | null;
  signal_unix_seconds: number;
  signal_time_et: string;
  signal_rvol: number | string;
  signal_price: number | string;
  change_pct: number | string;
  status: "pending" | "sent" | "skipped" | "failed";
  recipients_count: number;
  browser_push_recipients_count: number | null;
  email_recipients_count: number | null;
  onesignal_notification_id: string | null;
  email_message_id: string | null;
  error: string | null;
  created_at: string;
};

type RvolSignalExport = {
  alert_key: string;
  et_date: string;
  ticker: string;
  signal_resolution: "1m" | "5m";
  signal_unix_seconds: number;
  signal_time_et: string;
  signal_at: string;
  signal_rvol: number | null;
  signal_price: number | null;
  change_pct: number | null;
  status: RvolDispatchRow["status"];
  recipients_count: number;
  browser_push_recipients_count: number | null;
  email_recipients_count: number | null;
  onesignal_notification_id: string | null;
  email_message_id: string | null;
  error: string | null;
  created_at: string;
};

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2_000;
const DEFAULT_LOOKBACK_DAYS = 7;
const CSV_COLUMNS: (keyof RvolSignalExport)[] = [
  "alert_key",
  "et_date",
  "ticker",
  "signal_resolution",
  "signal_unix_seconds",
  "signal_time_et",
  "signal_at",
  "signal_rvol",
  "signal_price",
  "change_pct",
  "status",
  "recipients_count",
  "browser_push_recipients_count",
  "email_recipients_count",
  "onesignal_notification_id",
  "email_message_id",
  "error",
  "created_at",
];

function configuredTokens() {
  return [process.env.RVOL_SIGNALS_READ_TOKEN, process.env.RVOL_SIGNALS_READ_TOKENS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function requestToken(req: NextRequest) {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return req.headers.get("x-longboard-rvol-token") ?? "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function authorize(req: NextRequest): NextResponse | null {
  const token = requestToken(req);
  const tokens = configuredTokens();
  if (!token || tokens.length === 0 || !tokens.some((configured) => safeEqual(token, configured))) {
    return NextResponse.json({ error: "RVOL signal feed is private." }, { status: 401 });
  }
  return null;
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function dateParam(value: string | null, fallback?: Date) {
  if (!value) return fallback ?? null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseLimit(value: string | null) {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromUnixSeconds(seconds: number) {
  return new Date(seconds * 1000).toISOString();
}

function normalize(row: RvolDispatchRow): RvolSignalExport {
  return {
    alert_key: row.alert_key,
    et_date: row.et_date,
    ticker: row.ticker,
    signal_resolution: row.signal_resolution ?? "1m",
    signal_unix_seconds: Number(row.signal_unix_seconds),
    signal_time_et: row.signal_time_et,
    signal_at: isoFromUnixSeconds(Number(row.signal_unix_seconds)),
    signal_rvol: numberValue(row.signal_rvol),
    signal_price: numberValue(row.signal_price),
    change_pct: numberValue(row.change_pct),
    status: row.status,
    recipients_count: row.recipients_count,
    browser_push_recipients_count: row.browser_push_recipients_count,
    email_recipients_count: row.email_recipients_count,
    onesignal_notification_id: row.onesignal_notification_id,
    email_message_id: row.email_message_id,
    error: row.error,
    created_at: row.created_at,
  };
}

function csvCell(value: unknown) {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function toCsv(rows: RvolSignalExport[]) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export async function GET(req: NextRequest) {
  const unauthorized = authorize(req);
  if (unauthorized) return unauthorized;

  const params = req.nextUrl.searchParams;
  const fallbackFrom = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const from = dateParam(params.get("from") ?? params.get("since"), fallbackFrom);
  const to = dateParam(params.get("to"));
  const limit = parseLimit(params.get("limit"));
  const status = params.get("status");
  const resolution = params.get("resolution") ?? params.get("res");
  const format = (params.get("format") ?? "json").toLowerCase();

  if (!from) {
    return NextResponse.json({ error: "Invalid from/since date." }, { status: 400 });
  }
  if (to && to.getTime() < from.getTime()) {
    return NextResponse.json({ error: "to must be after from." }, { status: 400 });
  }
  if (status && !["pending", "sent", "skipped", "failed"].includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }
  if (resolution && resolution !== "all" && !["1m", "5m"].includes(resolution)) {
    return NextResponse.json({ error: "Invalid resolution." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    let query = admin
      .from("rvol_alert_dispatches")
      .select(
        "alert_key,et_date,ticker,signal_resolution,signal_unix_seconds,signal_time_et,signal_rvol,signal_price,change_pct,status,recipients_count,browser_push_recipients_count,email_recipients_count,onesignal_notification_id,email_message_id,error,created_at",
      )
      .gte("signal_unix_seconds", Math.floor(from.getTime() / 1000))
      .order("signal_unix_seconds", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(limit);

    if (to) query = query.lte("signal_unix_seconds", Math.floor(to.getTime() / 1000));
    if (status) query = query.eq("status", status);
    if (resolution && resolution !== "all") query = query.eq("signal_resolution", resolution);

    const { data, error } = await query;
    if (error) throw error;

    const signals = ((data ?? []) as RvolDispatchRow[]).map(normalize);

    if (format === "csv") {
      return new NextResponse(toCsv(signals), {
        headers: {
          "cache-control": "no-store",
          "content-disposition": "attachment; filename=\"longboard-rvol-signals.csv\"",
          "content-type": "text/csv; charset=utf-8",
        },
      });
    }

    return NextResponse.json(
      {
        generated_at: new Date().toISOString(),
        source: "longboard:rvol_alert_dispatches",
        window: {
          from: from.toISOString(),
          to: to ? to.toISOString() : null,
          limit,
          status: status ?? null,
          resolution: resolution ?? null,
        },
        count: signals.length,
        signals,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rvol_signal_feed_failed" },
      { status: 500 },
    );
  }
}
