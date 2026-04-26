import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAG_MAX_LEN = 64;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

  let body: { tag?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const tag = typeof body.tag === "string" ? body.tag.trim() : "";
  if (!tag) {
    return NextResponse.json({ error: "tag_required" }, { status: 400 });
  }
  if (tag.length > TAG_MAX_LEN) {
    return NextResponse.json({ error: "tag_too_long", max: TAG_MAX_LEN }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotent: upsert against the (user_id, tag) primary key. A re-add
  // is a no-op rather than a 409, which matches what the UI wants.
  const { error } = await admin
    .from("user_tags")
    .upsert(
      { user_id: id, tag, created_by: auth.user.id },
      { onConflict: "user_id,tag" }
    );

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ user_id: id, tag });
}
