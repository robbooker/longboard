import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { getKillSwitchState, getEnvOverride } from "@/lib/killSwitch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authGate(): Promise
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; response: NextResponse }
> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }

  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.includes(user.email.toLowerCase())) {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, user: { id: user.id, email: user.email } };
}

export async function GET() {
  const gate = await authGate();
  if (!gate.ok) return gate.response;

  const state = await getKillSwitchState();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const gate = await authGate();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "body.enabled must be boolean" },
      { status: 400 }
    );
  }
  const nextEnabled = body.enabled;

  if (nextEnabled && getEnvOverride()) {
    return NextResponse.json(
      {
        error: "env_override_active",
        message:
          "DISABLE_ORDER_SUBMISSION=true is set in Vercel. Remove it before re-enabling via the toggle.",
      },
      { status: 409 }
    );
  }

  const adminUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "server_misconfigured", message: "Missing service role key" },
      { status: 500 }
    );
  }
  const admin = createClient(adminUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing } = await admin
    .from("app_settings")
    .select("updated_at")
    .eq("id", 1)
    .single();

  if (existing?.updated_at) {
    const ageMs = Date.now() - new Date(existing.updated_at).getTime();
    if (ageMs < 5_000) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: "Kill switch was just changed. Wait a few seconds.",
        },
        { status: 429 }
      );
    }
  }

  const { error: updateErr } = await admin
    .from("app_settings")
    .update({
      order_submission_enabled: nextEnabled,
      updated_by: user.id,
      updated_by_email: user.email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (updateErr) {
    return NextResponse.json(
      { error: "update_failed", message: updateErr.message },
      { status: 500 }
    );
  }

  const state = await getKillSwitchState();
  return NextResponse.json(state);
}
