import { NextRequest, NextResponse } from "next/server";
import {
  isLiveRefreshWindow,
  isMorningBuildMinute,
  runFullReportBuild,
  runLiveRefresh,
} from "@/lib/morning-report/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

export async function GET(req: NextRequest) {
  const unauthorized = authorizeCron(req);
  if (unauthorized) return unauthorized;

  if (isMorningBuildMinute()) {
    const job = await runFullReportBuild({ trigger: "scheduled" });
    return NextResponse.json({ job }, { status: job.status === "failed" ? 500 : 200 });
  }

  if (isLiveRefreshWindow()) {
    const job = await runLiveRefresh({ trigger: "scheduled" });
    return NextResponse.json({ job }, { status: job.status === "failed" ? 500 : 200 });
  }

  return NextResponse.json({ job: { status: "skipped", error_summary: "Outside morning report operating window." } });
}
