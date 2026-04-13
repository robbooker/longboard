import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

  let body: { role?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const nextRole = body.role;
  if (nextRole !== "user" && nextRole !== "admin") {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }

  if (id === auth.user.id && nextRole === "user") {
    return NextResponse.json({ error: "cannot_demote_self" }, { status: 400 });
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
    .from("profiles")
    .update({ role: nextRole, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, email, role, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
