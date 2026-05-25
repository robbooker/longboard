import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isEmailChannelConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RVOL_ALERTS_FROM_EMAIL);
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rvol_alert_preferences")
    .select("browser_push_enabled,email_enabled")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    browserPushEnabled: data?.browser_push_enabled === true,
    emailEnabled: data?.email_enabled === true,
    oneSignalConfigured: Boolean(process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID),
    emailChannelConfigured: isEmailChannelConfigured(),
    email: auth.user.email,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const hasBrowserPushEnabled = typeof body?.browserPushEnabled === "boolean";
  const hasEmailEnabled = typeof body?.emailEnabled === "boolean";

  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("rvol_alert_preferences")
    .select("browser_push_enabled,email_enabled")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const browserPushEnabled = hasBrowserPushEnabled
    ? body.browserPushEnabled === true
    : existing?.browser_push_enabled === true;
  const emailEnabled = hasEmailEnabled
    ? body.emailEnabled === true
    : existing?.email_enabled === true;

  if (emailEnabled && !isEmailChannelConfigured()) {
    return NextResponse.json({ error: "email_channel_not_configured" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("rvol_alert_preferences")
    .upsert(
      {
        user_id: auth.user.id,
        browser_push_enabled: browserPushEnabled,
        email_enabled: emailEnabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("browser_push_enabled,email_enabled")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    browserPushEnabled: data.browser_push_enabled === true,
    emailEnabled: data.email_enabled === true,
    oneSignalConfigured: Boolean(process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID),
    emailChannelConfigured: isEmailChannelConfigured(),
    email: auth.user.email,
  });
}
