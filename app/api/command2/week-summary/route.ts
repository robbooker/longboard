import { NextResponse } from "next/server";
import { getLatestMorningArchiveWeekSummary } from "@/lib/morningArchive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public aggregate of the same reports already exposed by /command2. The
// service selects the latest saved version for each weekday, so price-refresh
// archive rows do not inflate the weekend totals.
export async function GET() {
  try {
    const summary = await getLatestMorningArchiveWeekSummary();
    return NextResponse.json(summary, {
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
