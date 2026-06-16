import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (id === auth.user.id) {
    return NextResponse.json({ error: "cannot_delete_self" }, { status: 400 });
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { error: deleteErr } = await admin.auth.admin.deleteUser(id);
  if (deleteErr) {
    return NextResponse.json({ error: "delete_failed", message: deleteErr.message }, { status: 500 });
  }

  // auth.users relationships should cascade, but this keeps the local
  // profile row tidy if the auth API returns success before a cascade is visible.
  await admin.from("profiles").delete().eq("id", id);

  return NextResponse.json({ id, deleted: true });
}
