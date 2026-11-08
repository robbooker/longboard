import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { inClubWindow, runStockClubTick } from "@/lib/stockClubServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * #386 Booker Stock Club: the 15-minute run (vercel.json). Authorized with CRON_SECRET like
 * /api/cron/morning-report-tick; outside 9:30 AM-4:00 PM New York on market days it does nothing.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // The browser test runs at any hour; the setting is ignored in a production build.
  const anyHour = process.env.NODE_ENV !== "production" && process.env.STOCK_CLUB_ANY_HOUR === "1";
  if (!anyHour && !inClubWindow(new Date()))
    return NextResponse.json({ status: "skipped", reason: "Outside market hours." });
  const db = createChatAdminClient();
  if (!db) return NextResponse.json({ error: "club_unavailable" }, { status: 503 });
  try {
    const result = await runStockClubTick(db);
    if (result.status === "posted") publishRoomEventAfterResponse("club", { kind: "changed", topics: ["history"] });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error("stock-club tick failed:", message);
    const error = ["room_paused", "club_unavailable", "facts_unavailable"].includes(message) ? message : "scan_failed";
    return NextResponse.json({ status: "failed", error }, { status: error === "room_paused" ? 423 : 503 });
  }
}
