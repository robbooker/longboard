import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashInviteToken } from "@/lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClaimBody = {
  token?: unknown;
  password?: unknown;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let body: ClaimBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!token || token.length > 256) {
    return NextResponse.json({ error: "invalid_invite" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }

  const admin = adminClient();
  const tokenHash = hashInviteToken(token);

  const { data: invite, error: inviteErr } = await admin
    .from("invites")
    .select("id, email, accepted_at, revoked_at, status")
    .eq("invite_token_hash", tokenHash)
    .maybeSingle();

  if (inviteErr) {
    return NextResponse.json({ error: "invite_lookup_failed", message: inviteErr.message }, { status: 500 });
  }
  if (!invite || invite.revoked_at || invite.accepted_at) {
    return NextResponse.json({ error: "invite_not_available" }, { status: 404 });
  }

  const email = String(invite.email).trim().toLowerCase();
  const { data: profileRows, error: profileErr } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1);

  if (profileErr) {
    return NextResponse.json({ error: "profile_lookup_failed", message: profileErr.message }, { status: 500 });
  }

  const existingUserId = profileRows?.[0]?.id as string | undefined;
  let userId = existingUserId;

  if (userId) {
    const { error: updateUserErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updateUserErr) {
      return NextResponse.json({ error: "user_update_failed", message: updateUserErr.message }, { status: 500 });
    }
  } else {
    const { data: created, error: createUserErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createUserErr || !created.user?.id) {
      return NextResponse.json(
        { error: "user_create_failed", message: createUserErr?.message ?? "No user returned" },
        { status: 500 }
      );
    }
    userId = created.user.id;
  }

  const { error: acceptErr } = await admin
    .from("invites")
    .update({ accepted_at: new Date().toISOString(), invite_token_hash: null })
    .eq("id", invite.id)
    .is("accepted_at", null)
    .is("revoked_at", null);

  if (acceptErr) {
    return NextResponse.json({ error: "invite_accept_failed", message: acceptErr.message }, { status: 500 });
  }

  return NextResponse.json({ email, userId });
}
