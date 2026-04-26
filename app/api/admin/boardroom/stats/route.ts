import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = [
  "total_sales_display", "total_sales_subtext",
  "collected_display",   "collected_subtext",
  "members_display",     "members_subtext",
  "new_leads_display",   "new_leads_subtext",
] as const;

/** PUT /api/admin/boardroom/stats
 *  Upserts the singleton stats row for a cohort.
 *  Body: { cohort, ...8 display/subtext fields } */
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.cohort !== "string" || !body.cohort) {
    return NextResponse.json({ error: "cohort_required" }, { status: 400 });
  }

  // Pick + coerce. Display fields are required (default to schema
  // defaults); subtext fields are optional (null allowed).
  const row: Record<string, unknown> = {
    cohort: body.cohort,
    updated_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };
  for (const f of ALLOWED_FIELDS) {
    if (f in body) {
      const v = body[f];
      row[f] = typeof v === "string" ? v : v == null ? null : String(v);
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("boardroom_stats")
    .upsert(row, { onConflict: "cohort" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "upsert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
