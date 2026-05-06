// GET /api/briefings/status?ticker=EVC — read-only poll endpoint.
//
// Returns the same shapes as POST /api/briefings/request but never inserts.
// Used by the briefing detail page to poll every 3s while waiting on Buddy.
//
//   curl -sS "$HOST/api/briefings/status?ticker=EVC" | jq

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { todayEt } from "@/lib/briefings/dates";
import type {
  BriefingApiResponse,
  BriefingRequestRow,
  StockBriefingRow,
} from "@/lib/briefings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const TICKER_RE = /^[A-Z0-9.]{1,10}$/;

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get("ticker") ?? "")
    .trim()
    .toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const briefingDate = todayEt();
  const supabase = adminSupabase();

  const { data: cached, error: cachedErr } = await supabase
    .from("stock_briefings")
    .select("*")
    .eq("ticker", ticker)
    .eq("briefing_date", briefingDate)
    .maybeSingle<StockBriefingRow>();

  if (cachedErr) {
    console.error("[briefings/status] stock_briefings lookup failed", cachedErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (cached) {
    const res: BriefingApiResponse = { status: "ready", briefing: cached };
    return NextResponse.json(res);
  }

  const { data: existing, error: existingErr } = await supabase
    .from("briefing_requests")
    .select("*")
    .eq("ticker", ticker)
    .eq("briefing_date", briefingDate)
    .maybeSingle<BriefingRequestRow>();

  if (existingErr) {
    console.error("[briefings/status] briefing_requests lookup failed", existingErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (!existing) {
    const res: BriefingApiResponse = { status: "not_requested" };
    return NextResponse.json(res);
  }

  if (existing.status === "pending" || existing.status === "running") {
    const res: BriefingApiResponse = {
      status: "pending",
      request_id: existing.id,
      queued_at: existing.requested_at,
    };
    return NextResponse.json(res);
  }

  if (existing.status === "error") {
    const res: BriefingApiResponse = {
      status: "error",
      request_id: existing.id,
      error_message: existing.error_message ?? "Unknown error",
    };
    return NextResponse.json(res);
  }

  // status === "done" but no stock_briefings row — orphan. POST cleans it up;
  // GET surfaces the inconsistency without mutating.
  console.error(
    `[briefings/status] orphan: request ${existing.id} done but no stock_briefings row for ${ticker}/${briefingDate}`,
  );
  const res: BriefingApiResponse = {
    status: "error",
    request_id: existing.id,
    error_message: "Briefing marked done but result not found. Re-request to retry.",
  };
  return NextResponse.json(res);
}
