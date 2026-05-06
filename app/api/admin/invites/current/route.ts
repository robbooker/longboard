import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CurrentInvite = {
  id: string;
  email: string;
  accepted_at: string | null;
  revoked_at: string | null;
  status: "pending" | "accepted" | "revoked";
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Returns the current authenticated user's latest non-revoked invite row.
 *  This is caller-scoped despite the /api/admin path: the client uses it to
 *  recover the onboarding password form after a Supabase invite link has
 *  already been consumed by the first click. */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { data, error } = await adminClient()
    .from("invites")
    .select("id, email, accepted_at, revoked_at, status")
    .eq("email", auth.user.email)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ invite: (data ?? null) as CurrentInvite | null });
}
