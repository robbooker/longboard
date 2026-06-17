import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["pending", "approved", "ignored", "promoted", "archived"]);

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  if (status && status !== "all" && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const supabase = await createClient();
  let query = supabase
    .from("bug_report_queue")
    .select("id, title, description, page_url, status, source, reported_by_email, slack_posted_at, slack_error, reviewed_by_email, reviewed_at, review_note, promoted_codex_task_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (status && status !== "all") {
    query = query.eq("status", status);
  } else if (!status) {
    query = query.eq("status", "pending");
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "load_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
}
