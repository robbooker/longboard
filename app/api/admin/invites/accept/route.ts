import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marks any active (non-accepted, non-revoked) invite for the current user's
 *  email as accepted. Despite living under /api/admin, this endpoint is
 *  caller-scoped (any authenticated user can call it for their own email) —
 *  the onboarding flow hits it right after the user sets their password.
 *
 *  Returns 200 { accepted: true, invite } if a matching row was updated.
 *  Returns 200 { accepted: false } if there was no matching active invite
 *  (e.g. the user signed up via some other path, or is arriving here via
 *  a password-reset flow). Only 401/403 on auth failure. */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("email", auth.user.email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ accepted: false });
  }
  return NextResponse.json({ accepted: true, invite: data });
}
