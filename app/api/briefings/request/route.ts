// POST /api/briefings/request — queue a ticker briefing for today (US/Eastern).
//
// Manual smoke test (replace HOST and run while a Supabase env is loaded):
//
//   # (a) cache hit — assumes a stock_briefings row already exists for EVC today:
//   curl -sS -X POST "$HOST/api/briefings/request" \
//     -H "content-type: application/json" -d '{"ticker":"EVC"}' | jq
//   # → { "status": "ready", "briefing": { ... } }
//
//   # (c) fresh request — no queue row, no result:
//   curl -sS -X POST "$HOST/api/briefings/request" \
//     -H "content-type: application/json" -d '{"ticker":"NEWX"}' | jq
//   # → { "status": "queued", "request_id": "..." }
//
//   # (b) duplicate request — repeat the same call before the worker finishes:
//   curl -sS -X POST "$HOST/api/briefings/request" \
//     -H "content-type: application/json" -d '{"ticker":"NEWX"}' | jq
//   # → { "status": "pending", "request_id": "...", "queued_at": "..." }
//
//   # (d) error surfacing — set status='error' on a row directly to test:
//   #   update briefing_requests set status='error',
//   #     error_message='boom' where ticker='NEWX' and briefing_date=current_date;
//   curl -sS -X POST "$HOST/api/briefings/request" \
//     -H "content-type: application/json" -d '{"ticker":"NEWX"}' | jq
//   # → { "status": "error", "request_id": "...", "error_message": "boom" }
//
// Auth: open for now. The schema has a nullable `requested_by` column for a
// future auth hookup; service role bypasses RLS so anonymous inserts work today.

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

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawTicker =
    body && typeof body === "object" && "ticker" in body &&
    typeof (body as { ticker: unknown }).ticker === "string"
      ? (body as { ticker: string }).ticker
      : "";
  const ticker = rawTicker.trim().toUpperCase();
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
    console.error("[briefings/request] stock_briefings lookup failed", cachedErr);
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
    console.error("[briefings/request] briefing_requests lookup failed", existingErr);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (existing) {
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
    if (existing.status === "done") {
      // Marked done but the result row is missing — orphan. Clear it and
      // re-queue so the worker can try again.
      console.error(
        `[briefings/request] orphan: request ${existing.id} done but no stock_briefings row for ${ticker}/${briefingDate}`,
      );
      await supabase.from("briefing_requests").delete().eq("id", existing.id);
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("briefing_requests")
    .upsert(
      { ticker, briefing_date: briefingDate, status: "pending" },
      { onConflict: "ticker,briefing_date", ignoreDuplicates: true },
    )
    .select()
    .maybeSingle<BriefingRequestRow>();

  if (insertErr) {
    console.error("[briefings/request] insert failed", insertErr);
    return NextResponse.json({ error: "Failed to queue request" }, { status: 500 });
  }

  if (!inserted) {
    // Conflict — another caller raced us. Re-select and report pending.
    const { data: race, error: raceErr } = await supabase
      .from("briefing_requests")
      .select("*")
      .eq("ticker", ticker)
      .eq("briefing_date", briefingDate)
      .maybeSingle<BriefingRequestRow>();

    if (raceErr || !race) {
      console.error("[briefings/request] race re-select failed", raceErr);
      return NextResponse.json({ error: "Failed to queue request" }, { status: 500 });
    }

    const res: BriefingApiResponse = {
      status: "pending",
      request_id: race.id,
      queued_at: race.requested_at,
    };
    return NextResponse.json(res);
  }

  const res: BriefingApiResponse = {
    status: "queued",
    request_id: inserted.id,
  };
  return NextResponse.json(res);
}
