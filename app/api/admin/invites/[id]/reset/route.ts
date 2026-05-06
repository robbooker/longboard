import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { id } = await params;
  const admin = adminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://longboardai.com"}/onboarding`;

  const { data: invite, error: updateErr } = await admin
    .from("invites")
    .update({ accepted_at: null, revoked_at: null })
    .eq("id", id)
    .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
    .maybeSingle();

  if (updateErr) {
    if (updateErr.code === "23505") {
      return NextResponse.json({ error: "active_invite_exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "reset_failed", message: updateErr.message }, { status: 500 });
  }

  if (!invite) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { error: emailErr } = await admin.auth.resetPasswordForEmail(invite.email, { redirectTo });
  if (emailErr) {
    return NextResponse.json({ error: "reset_email_failed", message: emailErr.message }, { status: 500 });
  }

  return NextResponse.json({ invite, resent: true });
}
