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

type InviteResponse = InviteRow & { resent?: boolean };

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
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://longboardai.com"}/onboarding`;

  // 1. If an active pending invite exists, resend a usable password setup
  //    link. The Supabase invite link itself is one-shot, but our invite row
  //    remains pending until the password is actually saved.
  const { data: existing } = await admin
    .from("invites")
    .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
    .eq("email", email)
    .is("revoked_at", null)
    .maybeSingle();

  if (existing) {
    const invite = existing as InviteRow;
    if (invite.status !== "pending") {
      return NextResponse.json({ error: "user_exists" }, { status: 409 });
    }

    // Supabase creates the auth user as soon as the invite is sent, and the
    // original email link is one-shot. For a still-pending invite, resend a
    // password setup link instead of blocking the admin with "already exists."
    const { error: resendErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (resendErr) {
      return NextResponse.json({ error: "invite_failed", message: resendErr.message }, { status: 500 });
    }

    return NextResponse.json({ ...invite, resent: true } satisfies InviteResponse);
  }

  // 2. Ask Supabase Auth to send the magic-link invite. This is also where
  //    "user already exists" gets caught — Supabase returns an error.
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
