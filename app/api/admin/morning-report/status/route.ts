import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getMorningReportStatus } from "@/lib/morning-report/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const status = await getMorningReportStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
