import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { importSlackBugReports, isSlackBugImportConfigured } from "@/lib/bugs/slackImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isSlackBugImportConfigured()) {
    return NextResponse.json({
      error: "slack_import_not_configured",
      message: "Set SLACK_BUGS_BOT_TOKEN and SLACK_BUGS_CHANNEL_ID to import #bugs messages.",
    }, { status: 400 });
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
