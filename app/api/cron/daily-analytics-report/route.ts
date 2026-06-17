import { NextRequest, NextResponse } from "next/server";
import { runDailyAnalyticsReport } from "@/lib/analytics/dailyReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorizeCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

async function handle(req: NextRequest) {
  const unauthorized = authorizeCron(req);
  if (unauthorized) return unauthorized;

  try {
    const result = await runDailyAnalyticsReport();
    if (!result.ok) {
      return NextResponse.json({
        status: "skipped",
        reason: "missing_configuration",
        missing: result.missing,
      });
    }
    return NextResponse.json({
      status: "ok",
      date: result.date,
      slackPosted: result.slackPosted,
      slackStatus: result.slackStatus,
      totals: result.totals,
      topPages: result.topPages,
      topSources: result.topSources,
    });
  } catch (error) {
    return NextResponse.json({
      error: "daily_analytics_report_failed",
      message: error instanceof Error ? error.message : "Daily analytics report failed.",
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
