import { NextResponse } from "next/server";
import { getLatestMorningArchive } from "@/lib/morningArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public read of the latest morning_email_archive row. /command2 is
// intentionally public during the build phase, so this route mirrors
// that visibility — no auth gate. Service role inside
// getLatestMorningArchive() is required because the table has RLS on
// with no policies; anon reads return zero rows.
export async function GET() {
  try {
    const snapshot = await getLatestMorningArchive();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
