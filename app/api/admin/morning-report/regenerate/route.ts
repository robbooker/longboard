import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { runFullReportBuild } from "@/lib/morning-report/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const job = await runFullReportBuild({
    trigger: "admin",
    actor: { id: auth.user.id, email: auth.user.email },
  });
  return NextResponse.json({ job }, { status: job.status === "failed" ? 500 : 200 });
}
