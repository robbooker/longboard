import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";
import { createInviteLink } from "@/lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAILS = 250;

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

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let body: { emails?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!Array.isArray(body.emails)) {
    return NextResponse.json({ error: "emails_required" }, { status: 400 });
  }

  const emails = Array.from(new Set(body.emails
    .map((raw) => typeof raw === "string" ? raw.trim().toLowerCase() : "")
    .filter((email) => EMAIL_RE.test(email))));

  if (emails.length === 0) {
    return NextResponse.json({ error: "no_valid_emails" }, { status: 400 });
  }
  if (emails.length > MAX_EMAILS) {
    return NextResponse.json({ error: "too_many_emails", max: MAX_EMAILS }, { status: 400 });
  }

  const admin = adminClient();
  const results = [];

  for (const email of emails) {
    const inviteLink = createInviteLink();
    const tokenPatch = {
      accepted_at: null,
      revoked_at: null,
      invite_token_hash: inviteLink.tokenHash,
      invite_token_created_at: new Date().toISOString(),
      invite_token_last_sent_at: new Date().toISOString(),
    };

    const { data: active } = await admin
      .from("invites")
      .select("id")
      .eq("email", email)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: anyInvite } = active ? { data: active } : await admin
      .from("invites")
      .select("id")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (anyInvite?.id) {
      const { data: invite, error } = await admin
        .from("invites")
        .update(tokenPatch)
        .eq("id", anyInvite.id)
        .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
        .single();

      results.push(error
        ? { email, ok: false, error: error.message }
        : { email, ok: true, invite: invite as InviteRow, invite_link: inviteLink.url, reset: true });
      continue;
    }

    const { data: invite, error } = await admin
      .from("invites")
      .insert({
        email,
        invited_by: auth.user.id,
        invited_by_email: auth.user.email,
        ...tokenPatch,
      })
      .select("id, email, invited_by_email, created_at, accepted_at, revoked_at, status")
      .single();

    results.push(error
      ? { email, ok: false, error: error.message }
      : { email, ok: true, invite: invite as InviteRow, invite_link: inviteLink.url, reset: false });
  }

  return NextResponse.json({ results });
}
