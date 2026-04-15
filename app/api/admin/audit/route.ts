import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT_KILL_SWITCH = 50;
const DEFAULT_LIMIT_ORDERS = 100;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Fetch audit rows — either kill_switch or orders type. Admin-gated.
 *  ?type=kill_switch|orders, ?limit=N (clamped to MAX_LIMIT). */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const type = req.nextUrl.searchParams.get("type");
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const parsedLimit = limitRaw ? Math.max(1, Math.min(MAX_LIMIT, parseInt(limitRaw, 10) || 0)) : null;

  const admin = adminClient();

  try {
    if (type === "kill_switch") {
      const limit = parsedLimit ?? DEFAULT_LIMIT_KILL_SWITCH;
      const { data, error } = await admin
        .from("app_settings_history")
        .select("id, changed_at, changed_by_email, field, old_value, new_value, source")
        .order("changed_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return NextResponse.json({ type, rows: data ?? [], limit });
    }

    if (type === "orders") {
      const limit = parsedLimit ?? DEFAULT_LIMIT_ORDERS;
      const { data, error } = await admin
        .from("order_audit")
        .select("id, created_at, user_email, broker, action, symbol, side, qty, order_type, response_status, error_message, duration_ms")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return NextResponse.json({ type, rows: data ?? [], limit });
    }

    return NextResponse.json({ error: "invalid_type", message: "Expected ?type=kill_switch or ?type=orders" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "fetch_failed", message: msg }, { status: 500 });
  }
}
