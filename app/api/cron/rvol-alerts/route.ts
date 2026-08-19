import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scanRvolBuySignals, type RvolScanDiagnostic, type RvolScannerHit } from "@/lib/scanners/rvolScanner";
import { sendOneSignalPush } from "@/lib/notifications/oneSignal";
import { isRvolSlackConfigured, sendRvolSlackAlert } from "@/lib/notifications/slackRvol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_MAX_ALERT_AGE_MINUTES = 5;
const ALERT_RESOLUTIONS = ["1m", "5m"] as const;

type DispatchRow = {
  alert_key: string;
};

type PreferenceRow = {
  user_id: string;
  browser_push_enabled: boolean;
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
  if (hit.resolution === "1m") {
    return `${etDate}:${hit.ticker}:${hit.signalUnixSeconds}`;
  }
  return `${etDate}:${hit.resolution}:${hit.ticker}:${hit.signalUnixSeconds}`;
}

function alertLabel(hit: RvolScannerHit): string {
  const setup = hit.breakoutMode === "openingRangeHigh" ? "opening range" : "PMH";
  return `RVOL ${hit.resolution} ${setup} print`;
}

function notificationUrl(): string {
  return `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.longboardai.com"}/scanner`;
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
    signal_resolution: hit.resolution,
    signal_unix_seconds: hit.signalUnixSeconds,
    signal_time_et: hit.signalTimeEt,
    signal_rvol: hit.signalRvol,
    signal_price: hit.signalPrice,
    change_pct: hit.changePct,
    signal_breakout_mode: hit.breakoutMode,
    breakout_level: hit.breakoutLevel,
    rvol_method: hit.rvolMethod,
    status: "pending",
  });

  if (error && error.code !== "23505") throw error;
}

async function persistDiagnostics(
  admin: ReturnType<typeof createAdminClient>,
  diagnostics: RvolScanDiagnostic[],
) {
  if (diagnostics.length === 0) return;
  const rows = diagnostics.map((diagnostic) => ({
    et_date: diagnostic.etDate,
    evaluation_source: "live_scan",
    signal_resolution: diagnostic.resolution,
    ticker: diagnostic.ticker,
    evaluated_at: diagnostic.evaluatedAt,
    qualified: diagnostic.qualified,
    breakout_mode: diagnostic.breakoutMode,
    rvol_method: diagnostic.rvolMethod,
    best_bar_unix_seconds: diagnostic.bestBarUnixSeconds,
    best_bar_time_et: diagnostic.bestBarTimeEt,
    rejection_reasons: diagnostic.rejectionReasons,
    conditions_passed: diagnostic.conditionsPassed,
    signal_rvol: diagnostic.signalRvol,
    breakout_level: diagnostic.breakoutLevel,
    cumulative_volume: diagnostic.cumulativeVolume,
    cumulative_volume_pace: diagnostic.cumulativeVolumePace,
    baseline_sessions: diagnostic.baselineSessions,
  }));
  const { error } = await admin
    .from("rvol_scan_diagnostics")
    .upsert(rows, { onConflict: "et_date,signal_resolution,ticker" });
  if (error) throw error;
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
    const scanResults = await Promise.all(
      ALERT_RESOLUTIONS.map((resolution) => scanRvolBuySignals({ resolution })),
    );
    try {
      await persistDiagnostics(admin, scanResults.flatMap((result) => result.diagnostics));
    } catch (diagnosticError) {
      console.error("rvol_scan_diagnostics_persist_failed", diagnosticError);
    }
    const alertCandidates = scanResults.flatMap((result) =>
      result.hits.map((hit) => ({ etDate: result.etDate, hit })),
    );
    const keys = alertCandidates.map(({ etDate, hit }) => alertKey(etDate, hit));

    if (keys.length === 0) {
      return NextResponse.json({
        status: "ok",
        etDate: scanResults[0]?.etDate ?? null,
        scanned: scanResults.reduce((sum, result) => sum + result.scanned, 0),
        scans: scanResults.map((result) => ({
          resolution: result.resolution,
          scanned: result.scanned,
          signals: result.hits.length,
        })),
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
    const freshHits = alertCandidates.filter(({ etDate, hit }) => !existingKeys.has(alertKey(etDate, hit)));

    if (freshHits.length === 0) {
      return NextResponse.json({
        status: "ok",
        etDate: scanResults[0]?.etDate ?? null,
        scanned: scanResults.reduce((sum, result) => sum + result.scanned, 0),
        scans: scanResults.map((result) => ({
          resolution: result.resolution,
          scanned: result.scanned,
          signals: result.hits.length,
        })),
        freshSignals: 0,
        notificationsAttempted: 0,
      });
    }

    for (const { etDate, hit } of freshHits) {
      await recordDispatch(admin, etDate, hit);
    }

    const nowMs = Date.now();
    const maxAgeMinutes = maxAlertAgeMinutes();
    const recentHits: typeof freshHits = [];
    const staleHits: typeof freshHits = [];

    for (const item of freshHits) {
      const { hit } = item;
      if (alertAgeMinutes(hit, nowMs) <= maxAgeMinutes) recentHits.push(item);
      else staleHits.push(item);
    }

    for (const { etDate, hit } of staleHits) {
      const key = alertKey(etDate, hit);
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
        etDate: scanResults[0]?.etDate ?? null,
        scanned: scanResults.reduce((sum, result) => sum + result.scanned, 0),
        scans: scanResults.map((result) => ({
          resolution: result.resolution,
          scanned: result.scanned,
          signals: result.hits.length,
        })),
        freshSignals: freshHits.length,
        staleSignalsSkipped: staleHits.length,
        maxAlertAgeMinutes: maxAgeMinutes,
        notificationsAttempted: 0,
      });
    }

    const { data: preferenceRows, error: preferenceError } = await admin
      .from("rvol_alert_preferences")
      .select("user_id,browser_push_enabled")
      .eq("browser_push_enabled", true);
    if (preferenceError) throw preferenceError;

    const preferences = (preferenceRows as PreferenceRow[] | null ?? []);
    const pushUserIds = preferences
      .filter((row) => row.browser_push_enabled)
      .map((row) => row.user_id);

    const sendResults = [];

    for (const { etDate, hit } of recentHits) {
      const key = alertKey(etDate, hit);
      const slackConfigured = isRvolSlackConfigured();
      const recipientsCount = pushUserIds.length + (slackConfigured ? 1 : 0);

      if (recipientsCount === 0) {
        await markDispatch(admin, key, {
          status: "skipped",
          recipients_count: 0,
          browser_push_recipients_count: 0,
          email_recipients_count: 0,
          error: "No users have requested RVOL alerts.",
        });
        sendResults.push({ alertKey: key, ticker: hit.ticker, resolution: hit.resolution, status: "skipped", recipients: 0 });
        continue;
      }

      const slack = slackConfigured ? await sendRvolSlackAlert({
        hit,
        etDate,
        url: notificationUrl(),
      }) : null;

      const push = pushUserIds.length > 0 ? await sendOneSignalPush({
        userIds: pushUserIds,
        heading: `${hit.ticker} ${alertLabel(hit)}`,
        content: `${hit.signalRvol.toFixed(1)}x RVOL at ${hit.signalTimeEt} ET / $${hit.signalPrice.toFixed(2)} / ${hit.changePct >= 0 ? "+" : ""}${hit.changePct.toFixed(1)}%`,
        url: notificationUrl(),
        name: `RVOL ${hit.resolution} ${hit.ticker} ${etDate} ${hit.signalTimeEt}`,
        topic: key.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 64),
        data: {
          type: "rvol_alert",
          alertKey: key,
          resolution: hit.resolution,
          setup: hit.breakoutMode === "openingRangeHigh" ? "opening range" : "PMH",
          ticker: hit.ticker,
          etDate,
          signalUnixSeconds: hit.signalUnixSeconds,
        },
      }) : null;

      const errors = [
        slack && !slack.ok ? `slack: ${slack.error ?? "failed"}` : null,
        push && !push.ok ? `push: ${push.error ?? "failed"}` : null,
      ].filter(Boolean);
      const sent = (!slack || slack.ok) && (!push || push.ok);

      await markDispatch(admin, key, {
        status: sent ? "sent" : "failed",
        recipients_count: recipientsCount,
        browser_push_recipients_count: pushUserIds.length,
        email_recipients_count: 0,
        onesignal_notification_id: push?.id ?? null,
        email_message_id: null,
        error: errors.length > 0 ? errors.join("; ") : null,
      });

      sendResults.push({
        alertKey: key,
        ticker: hit.ticker,
        resolution: hit.resolution,
        status: sent ? "sent" : "failed",
        recipients: recipientsCount,
        slackSent: slack?.ok ?? false,
        browserPushRecipients: pushUserIds.length,
        emailRecipients: 0,
        notificationId: push?.id ?? null,
        emailMessageId: null,
        error: errors.length > 0 ? errors.join("; ") : null,
        warnings: push?.warnings ?? null,
      });
    }

    return NextResponse.json({
      status: "ok",
      etDate: scanResults[0]?.etDate ?? null,
      scanned: scanResults.reduce((sum, result) => sum + result.scanned, 0),
      scans: scanResults.map((result) => ({
        resolution: result.resolution,
        scanned: result.scanned,
        signals: result.hits.length,
      })),
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
