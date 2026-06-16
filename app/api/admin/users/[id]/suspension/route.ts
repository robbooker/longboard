import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SuspensionBody = {
  suspended?: unknown;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

  let body: SuspensionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.suspended !== "boolean") {
    return NextResponse.json({ error: "invalid_suspended" }, { status: 400 });
  }

  if (id === auth.user.id) {
    return NextResponse.json({ error: "cannot_suspend_self" }, { status: 400 });
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { data, error } = await admin.auth.admin.updateUserById(id, {
    ban_duration: body.suspended ? "876000h" : "none",
  });

  if (error) {
    return NextResponse.json({ error: "suspension_update_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id,
    suspended: body.suspended,
    banned_until: data.user?.banned_until ?? null,
  });
}
