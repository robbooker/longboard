import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/admin/boardroom/welcome
 *  Upserts the singleton welcome row for a cohort.
 *  Body: { cohort, body_markdown } */
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { cohort?: unknown; body_markdown?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const cohort = typeof body.cohort === "string" ? body.cohort : "";
  const markdown = typeof body.body_markdown === "string" ? body.body_markdown : "";
  if (!cohort) return NextResponse.json({ error: "cohort_required" }, { status: 400 });
  if (!markdown) return NextResponse.json({ error: "body_markdown_required" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("boardroom_welcome")
    .upsert(
      {
        cohort,
        body_markdown: markdown,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cohort" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "upsert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
