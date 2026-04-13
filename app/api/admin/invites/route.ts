import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type InviteRow = {
  id: string;
  email: string;
  invited_by_email: string;
  created_at: string;
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

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const { data, error } = await adminClient()
    .from("invites")
    .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "fetch_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ invites: (data ?? []) as InviteRow[] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.email !== "string" || !EMAIL_RE.test(body.email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const email = body.email.trim().toLowerCase();

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  const admin = adminClient();

  // 1. Refuse only if an ACTIVE (non-revoked) invite row already exists for
  //    this email. The partial unique index invites_email_active_unique
  //    enforces the same rule at the DB level, so we return a clean 409
  //    rather than letting the insert below hit a constraint error.
  const { data: existing } = await admin
    .from("invites")
    .select("id, status")
    .eq("email", email)
    .is("revoked_at", null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "invite_pending" }, { status: 409 });
  }

  // 2. Ask Supabase Auth to send the magic-link invite. This is also where
  //    "user already exists" gets caught — Supabase returns an error.
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://longboard-ruddy.vercel.app"}/onboarding`;
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (inviteErr) {
    const msg = inviteErr.message?.toLowerCase() ?? "";
    if (msg.includes("already") || msg.includes("exists") || msg.includes("registered")) {
      return NextResponse.json({ error: "user_exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "invite_failed", message: inviteErr.message }, { status: 500 });
  }

  // 3. Record the invite. If this fails after the email already went out,
  //    worst case is a duplicate-send on retry — but the unique constraint
  //    on email means step 1 will catch it.
  const { data: inserted, error: insertErr } = await admin
    .from("invites")
    .insert({
      email,
      invited_by: auth.user.id,
      invited_by_email: auth.user.email,
    })
    .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: "record_failed", message: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(inserted);
}
