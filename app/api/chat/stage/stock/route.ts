import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { gainersQuotes } from "@/lib/chatGainersQuotes";
import { gainersShares } from "@/lib/chatGainersShares";
import { parseStageTicker } from "@/lib/chatStageLive";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { parseStageRoom, readStageOnScreen, sharedStageOnScreen, stageVideoConfig } from "@/lib/chatStageVideo";
import { ChatTimingRateLimit } from "@/lib/chatTimings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// #512: an open stage asks for the stock the host put on screen when it is off today's table, and
// again every 15 seconds while it stays there: 20 in five minutes for each tab watching. 60 in five
// minutes per account (per server instance) leaves room for three tabs, and stops this address
// being used to look up one ticker after another.
const STOCK_LOOKUPS = 60;
const STOCK_LOOKUPS_WINDOW_MS = 5 * 60_000;
const limiter = new ChatTimingRateLimit(STOCK_LOOKUPS, STOCK_LOOKUPS_WINDOW_MS);

/**
 * #507: what the app can really say about a stock the host put on screen that is NOT on today's
 * Gainers Table: its price, % today and volume today (Polygon's snapshot) and its shares outstanding
 * (Polygon's ticker details), through the Gainers Table's own cached reads (15 seconds, and a day).
 * Nothing else: no borrow, cash, float or ownership, and no lookup on the home machine is started.
 * For the members who can open the Gainers room (the table's own rule). Asked only by an open stage
 * showing such a stock. A part Polygon has no answer for is null, and the stage shows "—".
 * #512: at most 60 lookups in five minutes per account (429 "rate_limited" after that; the stage
 * keeps the numbers it has, or "—", and asks again a minute later).
 * #523: `room` is required, and the answer is given only for the ticker that is on screen in that
 * room right now (409 "not_on_screen" for any other), so this address cannot be used to look up
 * one stock after another. What is on screen is this server's few-second memory of the LiveKit
 * room (the on-screen route forgets it when the host changes the stock).
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const param = request.nextUrl.searchParams.get("ticker");
  const ticker = parseStageTicker(param);
  if (!ticker || ticker !== param) return json({ error: "invalid_ticker" }, 400);
  const room = parseStageRoom(request.nextUrl.searchParams.get("room"));
  if (!room) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const config = stageVideoConfig();
  if (!config) return json({ error: "video_off" }, 404);
  if (!limiter.allow(auth.user.id)) return json({ error: "rate_limited" }, 429);
  const api = stageVideoApi(config);
  const onScreen = await sharedStageOnScreen(room, () => readStageOnScreen(api, room));
  if (onScreen?.symbol !== ticker) return json({ error: "not_on_screen" }, 409);
  const [quotes, shares] = await Promise.all([
    gainersQuotes([ticker]).catch(() => null),
    gainersShares([ticker]).catch(() => null),
  ]);
  return json({ ticker, quote: quotes?.get(ticker) ?? null, sharesOutstanding: shares?.get(ticker) ?? null });
}
