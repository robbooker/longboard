import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = ["pending", "invited", "rejected"] as const;
type AllowedStatus = typeof ALLOWED_STATUSES[number];

/** PATCH updates a signup_request's status. The 'duplicate' status is
 *  set only by the public insert path — admins can't move things there
 *  manually. Also writes reviewed_by + reviewed_at when moving to a
 *  reviewed state. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const next = body.status;
  if (typeof next !== "string" || !ALLOWED_STATUSES.includes(next as AllowedStatus)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const updates: Record<string, unknown> = { status: next };
  if (next === "invited" || next === "rejected") {
    updates.reviewed_by = auth.user.id;
    updates.reviewed_at = new Date().toISOString();
  }

  const { data, error } = await admin
    .from("signup_requests")
    .update(updates)
    .eq("id", id)
    .select("id, email, message, status, created_at, reviewed_by, reviewed_at, source_ip, user_agent")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
