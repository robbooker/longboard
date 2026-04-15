import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getKillSwitchState, getEnvOverride } from "@/lib/killSwitch";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const state = await getKillSwitchState();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { user } = auth;

  let body: { enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "body.enabled must be boolean" }, { status: 400 });
  }
  const nextEnabled = body.enabled;

  if (nextEnabled && getEnvOverride()) {
    return NextResponse.json(
      {
        error: "env_override_active",
        message: "DISABLE_ORDER_SUBMISSION=true is set in Vercel. Remove it before re-enabling via the toggle.",
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
    .select("order_submission_enabled, updated_at")
    .eq("id", 1)
    .single();

  if (existing?.updated_at) {
    const ageMs = Date.now() - new Date(existing.updated_at).getTime();
    if (ageMs < 5000) {
      return NextResponse.json(
        { error: "rate_limited", message: "Kill switch was just changed. Wait a few seconds." },
        { status: 429 }
      );
    }
  }

  const oldValue = existing?.order_submission_enabled ?? null;

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

  // Audit the flip. Fire-and-forget — if app_settings_history doesn't
  // exist yet (migration not applied) or the insert fails for any other
  // reason, we still want the kill-switch flip itself to succeed.
  if (oldValue !== nextEnabled) {
    admin
      .from("app_settings_history")
      .insert({
        changed_by: user.id,
        changed_by_email: user.email,
        field: "order_submission_enabled",
        old_value: oldValue,
        new_value: nextEnabled,
        source: "ui",
      })
      .then(({ error }) => {
        if (error) console.warn("[kill-switch audit] insert failed:", error.message);
      });
  }

  const state = await getKillSwitchState();
  return NextResponse.json(state);
}
