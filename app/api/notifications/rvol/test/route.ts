import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sendOneSignalPush } from "@/lib/notifications/oneSignal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await sendOneSignalPush({
    userIds: [auth.user.id],
    heading: "Longboard RVOL test",
    content: "Your browser push subscription is working.",
    url: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.longboardai.com"}/scanner`,
    name: `RVOL browser push test ${new Date().toISOString()}`,
    topic: `rvol_test_${auth.user.id}`.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 64),
    data: { type: "rvol_alert_test" },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
