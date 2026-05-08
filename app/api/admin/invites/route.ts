import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";
import { createInviteLink } from "@/lib/invites";

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
type InviteLinkResponse = InviteResponse & { invite_link: string };

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
  const inviteLink = createInviteLink();

  // 1. If an invite already exists, reset it to pending with a fresh durable
  //    app-owned token. Supabase Auth invite/recovery links are one-shot and
  //    time-limited, so the durable link must be owned by Longboard instead.
  const { data: activeInvite } = await admin
    .from("invites")
    .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
    .eq("email", email)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: existing } = activeInvite ? { data: activeInvite } : await admin
    .from("invites")
    .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { data: updated, error: updateErr } = await admin
      .from("invites")
      .update({
        accepted_at: null,
        revoked_at: null,
        invite_token_hash: inviteLink.tokenHash,
        invite_token_created_at: new Date().toISOString(),
        invite_token_last_sent_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: "invite_reset_failed", message: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ...(updated as InviteRow), resent: true, invite_link: inviteLink.url } satisfies InviteLinkResponse);
  }

  const { data: inserted, error: insertErr } = await admin
    .from("invites")
    .insert({
      email,
      invited_by: auth.user.id,
      invited_by_email: auth.user.email,
      invite_token_hash: inviteLink.tokenHash,
      invite_token_created_at: new Date().toISOString(),
      invite_token_last_sent_at: new Date().toISOString(),
    })
    .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: "record_failed", message: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ...(inserted as InviteRow), invite_link: inviteLink.url } satisfies InviteLinkResponse);
}
