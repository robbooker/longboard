import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { balloonsFeed } from "@/lib/gainerBalloons/feed.server";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #528 Gainer Balloons: the day's gainers (the Gainers Table's list, at most 60) with each one's
 * country, float, yesterday's close and 2-minute bars so far. For the members who can open the
 * gainers room, nobody else. ?since=<epoch ms> sends only the bars from then on (the page's
 * once-a-minute refresh). Polygon is read on the server only, at most once a minute per stock for
 * all viewers (lib/gainerBalloons/feed.server.ts); nothing about where the numbers come from, and
 * no key, is in the answer.
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const db = createChatAdminClient();
  if (!db) return json({ error: "balloons_unavailable" }, 503);
  const raw = request.nextUrl.searchParams.get("since");
  const since = raw !== null && /^\d{10,14}$/.test(raw) ? Number(raw) : null;
  try {
    const feed = await balloonsFeed(db, { since });
    return feed ? json(feed) : json({ error: "balloons_unavailable" }, 503);
  } catch {
    return json({ error: "balloons_unavailable" }, 503);
  }
}
