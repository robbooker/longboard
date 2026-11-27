// #529 Booker Tube: the daily refresh. Runs once a day before the New York morning
// (vercel.json), reads each channel's public feed in turn and stores the newly scored list.
// A bad day (most feeds failing) stores nothing, so the page keeps the last good list.
import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { refreshCollection, VIDEO_PICKS_SLUG } from "@/lib/videoPicksServer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, 401);
  const db = createChatAdminClient();
  if (!db) return json({ error: "Refresh unavailable" }, 503);
  try {
    const outcome = await refreshCollection(db, VIDEO_PICKS_SLUG);
    // Quiet until the migration is applied: nothing to refresh yet.
    if (!outcome) return json({ ready: false });
    if (!outcome.stored) console.warn(`[video-picks] kept the last list: ${outcome.reason}`, outcome.stats.failed.length, "feeds failed");
    return json({ stored: outcome.stored, reason: outcome.reason, ...outcome.stats, failed: outcome.stats.failed.length });
  } catch {
    return json({ error: "Refresh failed; it runs again tomorrow." }, 503);
  }
}
