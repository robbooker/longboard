import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SignupRequest = {
  id: string;
  email: string;
  message: string | null;
  status: "pending" | "invited" | "rejected" | "duplicate";
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  source_ip: string | null;
  user_agent: string | null;
};

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Status ordering: pending first (most actionable), then invited, then
  // rejected, then duplicate. Within each bucket, most recent first. This
  // matches the default view the admin panel expects.
  const statusOrder: Record<SignupRequest["status"], number> = {
    pending: 0, invited: 1, rejected: 2, duplicate: 3,
  };

  const { data, error } = await admin
    .from("signup_requests")
    .select("id, email, message, status, created_at, reviewed_by, reviewed_at, source_ip, user_agent")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  const requests = (data ?? []) as SignupRequest[];
  requests.sort((a, b) => {
    const s = statusOrder[a.status] - statusOrder[b.status];
    if (s !== 0) return s;
    return a.created_at < b.created_at ? 1 : -1;
  });

  return NextResponse.json({ requests });
}
