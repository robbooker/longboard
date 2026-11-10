import { NextResponse, type NextRequest } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { radioKeyTiming, radioListenKey } from "@/lib/chatRadioAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #415 Trader Radio: the one place a listener's membership is checked. Whoever can open the Gainers
 * room gets the address of the shared playout, good for the current key window. A player calls this
 * when play is pressed and again about every 15 minutes while it keeps playing; never while paused.
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const now = Date.now();
  const key = radioListenKey(now);
  if (!key) return json({ error: "radio_unavailable" }, 503);
  return json({ playout: `/api/chat/radio/playout/${key}`, ...radioKeyTiming(now) });
}
