import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tag: string }> }
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id, tag: rawTag } = await params;
  // Tag comes through the URL — Next.js decodes it once, but a tag
  // with reserved chars (unlikely for boardroom-cohort-N) would still
  // need URL-encoded routing on the client side.
  const tag = decodeURIComponent(rawTag);

  if (!tag) {
    return NextResponse.json({ error: "tag_required" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotent delete — no error if the row was already gone. The UI
  // refreshes the list afterwards either way.
  const { error } = await admin
    .from("user_tags")
    .delete()
    .eq("user_id", id)
    .eq("tag", tag);

  if (error) {
    return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ user_id: id, tag, removed: true });
}
