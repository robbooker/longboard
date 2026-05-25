import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type RvolDispatchRow = {
  alert_key: string;
  et_date: string;
  ticker: string;
  signal_time_et: string;
  signal_rvol: number | string;
  signal_price: number | string;
  change_pct: number | string;
  recipients_count: number;
  browser_push_recipients_count: number | null;
  email_recipients_count: number | null;
  status: "pending" | "sent" | "skipped" | "failed";
  error: string | null;
  created_at: string;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseLimit(raw: string | null) {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function toNumber(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const limit = parseLimit(req.nextUrl.searchParams.get("limit"));
    const admin = adminClient();
    const { data, error } = await admin
      .from("rvol_alert_dispatches")
      .select(
        "alert_key,et_date,ticker,signal_time_et,signal_rvol,signal_price,change_pct,recipients_count,browser_push_recipients_count,email_recipients_count,status,error,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: "history_query_failed", message: error.message }, { status: 500 });
    }

    const alerts = ((data ?? []) as RvolDispatchRow[]).map((row) => ({
      alertKey: row.alert_key,
      etDate: row.et_date,
      ticker: row.ticker,
      signalTimeEt: row.signal_time_et,
      signalRvol: toNumber(row.signal_rvol),
      signalPrice: toNumber(row.signal_price),
      changePct: toNumber(row.change_pct),
      recipientsCount: row.recipients_count,
      browserPushRecipientsCount: row.browser_push_recipients_count ?? 0,
      emailRecipientsCount: row.email_recipients_count ?? 0,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ alerts, limit });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rvol_history_failed" },
      { status: 500 },
    );
  }
}
