import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scanRvolBuySignals, type RvolScannerHit } from "@/lib/scanners/rvolScanner";
import { sendOneSignalPush } from "@/lib/notifications/oneSignal";
import { sendRvolAlertEmail } from "@/lib/notifications/resendEmail";
import { isRvolSlackConfigured, sendRvolSlackAlert } from "@/lib/notifications/slackRvol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_MAX_ALERT_AGE_MINUTES = 5;

type DispatchRow = {
  alert_key: string;
};

type PreferenceRow = {
  user_id: string;
  browser_push_enabled: boolean;
  email_enabled: boolean;
};

type ProfileRow = {
  id: string;
  email: string;
};

function authorizeCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role is not configured.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function alertKey(etDate: string, hit: RvolScannerHit): string {
  return `${etDate}:${hit.ticker}:${hit.signalUnixSeconds}`;
}

function notificationUrl(): string {
  return `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://longboardai.com"}/scanner`;
}

function maxAlertAgeMinutes(): number {
  const raw = process.env.RVOL_ALERT_MAX_AGE_MINUTES;
  if (!raw) return DEFAULT_MAX_ALERT_AGE_MINUTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ALERT_AGE_MINUTES;
}

function alertAgeMinutes(hit: RvolScannerHit, nowMs: number): number {
  return (nowMs - hit.signalUnixSeconds * 1000) / 60_000;
}

async function recordDispatch(
  admin: ReturnType<typeof createAdminClient>,
  etDate: string,
  hit: RvolScannerHit,
) {
  const { error } = await admin.from("rvol_alert_dispatches").insert({
    alert_key: alertKey(etDate, hit),
    et_date: etDate,
    ticker: hit.ticker,
    signal_unix_seconds: hit.signalUnixSeconds,
    signal_time_et: hit.signalTimeEt,
    signal_rvol: hit.signalRvol,
    signal_price: hit.signalPrice,
    change_pct: hit.changePct,
    status: "pending",
  });

  if (error && error.code !== "23505") throw error;
}

async function markDispatch(
  admin: ReturnType<typeof createAdminClient>,
  key: string,
  update: {
    status: "sent" | "skipped" | "failed";
    recipients_count: number;
    browser_push_recipients_count?: number;
    email_recipients_count?: number;
    onesignal_notification_id?: string | null;
    email_message_id?: string | null;
    error?: string | null;
  },
) {
  await admin
    .from("rvol_alert_dispatches")
    .update(update)
    .eq("alert_key", key);
}

export async function GET(req: NextRequest) {
  const unauthorized = authorizeCron(req);
  if (unauthorized) return unauthorized;

  try {
    const admin = createAdminClient();
    const result = await scanRvolBuySignals();
    const keys = result.hits.map((hit) => alertKey(result.etDate, hit));

    if (keys.length === 0) {
      return NextResponse.json({
        status: "ok",
        etDate: result.etDate,
        scanned: result.scanned,
        freshSignals: 0,
        notificationsAttempted: 0,
      });
    }

    const { data: existingRows, error: existingError } = await admin
      .from("rvol_alert_dispatches")
      .select("alert_key")
      .in("alert_key", keys);
    if (existingError) throw existingError;

    const existingKeys = new Set((existingRows as DispatchRow[] | null ?? []).map((row) => row.alert_key));
    const freshHits = result.hits.filter((hit) => !existingKeys.has(alertKey(result.etDate, hit)));

    if (freshHits.length === 0) {
      return NextResponse.json({
        status: "ok",
        etDate: result.etDate,
        scanned: result.scanned,
        freshSignals: 0,
        notificationsAttempted: 0,
      });
    }

    for (const hit of freshHits) {
      await recordDispatch(admin, result.etDate, hit);
    }

    const nowMs = Date.now();
    const maxAgeMinutes = maxAlertAgeMinutes();
    const recentHits: RvolScannerHit[] = [];
    const staleHits: RvolScannerHit[] = [];

    for (const hit of freshHits) {
      if (alertAgeMinutes(hit, nowMs) <= maxAgeMinutes) recentHits.push(hit);
      else staleHits.push(hit);
    }

    for (const hit of staleHits) {
      const key = alertKey(result.etDate, hit);
      await markDispatch(admin, key, {
        status: "skipped",
        recipients_count: 0,
        browser_push_recipients_count: 0,
        email_recipients_count: 0,
        error: `RVOL signal was older than ${maxAgeMinutes} minutes when detected.`,
      });
    }

    if (recentHits.length === 0) {
      return NextResponse.json({
        status: "ok",
        etDate: result.etDate,
        scanned: result.scanned,
        freshSignals: freshHits.length,
        staleSignalsSkipped: staleHits.length,
        maxAlertAgeMinutes: maxAgeMinutes,
        notificationsAttempted: 0,
      });
    }

    const { data: preferenceRows, error: preferenceError } = await admin
      .from("rvol_alert_preferences")
      .select("user_id,browser_push_enabled,email_enabled")
      .or("browser_push_enabled.eq.true,email_enabled.eq.true");
    if (preferenceError) throw preferenceError;

    const preferences = (preferenceRows as PreferenceRow[] | null ?? []);
    const pushUserIds = preferences
      .filter((row) => row.browser_push_enabled)
      .map((row) => row.user_id);
    const emailUserIds = preferences
      .filter((row) => row.email_enabled)
      .map((row) => row.user_id);
    let emailRecipients: string[] = [];

    if (emailUserIds.length > 0) {
      const { data: profiles, error: profileError } = await admin
        .from("profiles")
        .select("id,email")
        .in("id", emailUserIds);
      if (profileError) throw profileError;

      emailRecipients = (profiles as ProfileRow[] | null ?? [])
        .map((profile) => profile.email)
        .filter(Boolean);
    }

    const sendResults = [];

    for (const hit of recentHits) {
      const key = alertKey(result.etDate, hit);
      const slackConfigured = isRvolSlackConfigured();
      const recipientsCount = pushUserIds.length + emailRecipients.length + (slackConfigured ? 1 : 0);

      if (recipientsCount === 0) {
        await markDispatch(admin, key, {
          status: "skipped",
          recipients_count: 0,
          browser_push_recipients_count: 0,
          email_recipients_count: 0,
          error: "No users have requested RVOL alerts.",
        });
        sendResults.push({ alertKey: key, ticker: hit.ticker, status: "skipped", recipients: 0 });
        continue;
      }

      const slack = slackConfigured ? await sendRvolSlackAlert({
        hit,
        etDate: result.etDate,
        url: notificationUrl(),
      }) : null;

      const push = pushUserIds.length > 0 ? await sendOneSignalPush({
        userIds: pushUserIds,
        heading: `${hit.ticker} RVOL print`,
        content: `${hit.signalRvol.toFixed(1)}x RVOL at ${hit.signalTimeEt} ET / $${hit.signalPrice.toFixed(2)} / ${hit.changePct >= 0 ? "+" : ""}${hit.changePct.toFixed(1)}%`,
        url: notificationUrl(),
        name: `RVOL ${hit.ticker} ${result.etDate} ${hit.signalTimeEt}`,
        topic: key.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 64),
        data: {
          type: "rvol_alert",
          alertKey: key,
          ticker: hit.ticker,
          etDate: result.etDate,
          signalUnixSeconds: hit.signalUnixSeconds,
        },
      }) : null;

      const email = emailRecipients.length > 0 ? await sendRvolAlertEmail({
        recipients: emailRecipients,
        ticker: hit.ticker,
        signalRvol: hit.signalRvol,
        signalTimeEt: hit.signalTimeEt,
        signalPrice: hit.signalPrice,
        changePct: hit.changePct,
        url: notificationUrl(),
      }) : null;

      const errors = [
        slack && !slack.ok ? `slack: ${slack.error ?? "failed"}` : null,
        push && !push.ok ? `push: ${push.error ?? "failed"}` : null,
        email && !email.ok ? `email: ${email.error ?? "failed"}` : null,
      ].filter(Boolean);
      const sent = (!slack || slack.ok) && (!push || push.ok) && (!email || email.ok);

      await markDispatch(admin, key, {
        status: sent ? "sent" : "failed",
        recipients_count: recipientsCount,
        browser_push_recipients_count: pushUserIds.length,
        email_recipients_count: emailRecipients.length,
        onesignal_notification_id: push?.id ?? null,
        email_message_id: email?.id ?? null,
        error: errors.length > 0 ? errors.join("; ") : null,
      });

      sendResults.push({
        alertKey: key,
        ticker: hit.ticker,
        status: sent ? "sent" : "failed",
        recipients: recipientsCount,
        slackSent: slack?.ok ?? false,
        browserPushRecipients: pushUserIds.length,
        emailRecipients: emailRecipients.length,
        notificationId: push?.id ?? null,
        emailMessageId: email?.id ?? null,
        error: errors.length > 0 ? errors.join("; ") : null,
        warnings: push?.warnings ?? null,
      });
    }

    return NextResponse.json({
      status: "ok",
      etDate: result.etDate,
      scanned: result.scanned,
      freshSignals: freshHits.length,
      staleSignalsSkipped: staleHits.length,
      maxAlertAgeMinutes: maxAgeMinutes,
      notificationsAttempted: sendResults.length,
      results: sendResults,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rvol_alert_cron_failed" },
      { status: 500 },
    );
  }
}
