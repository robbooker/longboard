import { NextRequest, NextResponse } from "next/server";
import { importSlackBugReports, isSlackBugImportConfigured } from "@/lib/bugs/slackImport";

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

export async function GET(req: NextRequest) {
  const unauthorized = authorizeCron(req);
  if (unauthorized) return unauthorized;
  if (!isSlackBugImportConfigured()) {
    return NextResponse.json({
      result: {
        ok: true,
        imported: 0,
        skipped: 0,
        duplicates: 0,
        errors: [],
        status: "skipped",
        reason: "Slack bug import is not configured.",
      },
    });
  }

  try {
    const result = await importSlackBugReports();
    return NextResponse.json({ result }, { status: result.ok ? 200 : 207 });
  } catch (error) {
    return NextResponse.json({
      error: "import_failed",
      message: error instanceof Error ? error.message : "Slack bug import failed.",
    }, { status: 500 });
  }
}
