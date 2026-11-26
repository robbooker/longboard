import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { isChatAdmin } from "@/lib/chatRole";
import { parseStageTicker } from "@/lib/chatStageLive";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { stageBody, stageOriginAllowed } from "@/lib/chatStageRequest";
import { forgetStageOnScreen, parseStageRoom, setStageOnScreen, stageVideoConfig } from "@/lib/chatStageVideo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #507: the host puts a stock on screen for everyone watching a room's stage, or clears it.
 * Body: { room, symbol } with `symbol` a ticker ("APUS", "BRK.B") or null to clear.
 * Chat admins only, signed in through the browser (never an API token or an agent), same-origin.
 * Only for a room that has its stream key (409 "not_started" otherwise; #512: a room has it from the
 * first time an admin opens its stage, so in practice always): the ticker is kept in that LiveKit
 * room's metadata (no database), where /api/chat/stage/status reads it for anyone who opens the
 * stage later. Open stages are told at once over the room's "stage" signal,
 * which carries the ticker itself.
 * #522: the body must be a JSON object that names its room (400 otherwise).
 */
export async function POST(req: NextRequest) {
  if (!stageOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const body = await stageBody(req);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!isChatAdmin(auth) || auth.apiToken || auth.agent) return json({ error: "admin_only" }, 403);
  const room = parseStageRoom(body?.room);
  if (!room || !body) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const symbol = body.symbol === null ? null : parseStageTicker(body.symbol);
  if (body.symbol !== null && !symbol) return json({ error: "invalid_symbol" }, 400);
  const config = stageVideoConfig();
  if (!config) return json({ error: "video_off" }, 404);
  try {
    const onScreen = await setStageOnScreen(stageVideoApi(config), room, symbol);
    if (!onScreen) return json({ error: "not_started" }, 409);
    // This server reads the stock again for the next status request; the signal carries the ticker
    // for stages already open (and each keeps the newest it has heard of). #523: only the stock is
    // forgotten: the room's state has not changed, so it is not read from LiveKit again for this.
    forgetStageOnScreen(room);
    publishRoomEventAfterResponse(room, { kind: "changed", topics: ["stage"], onScreen });
    return json({ onScreen });
  } catch {
    return json({ error: "livekit_unavailable" }, 502);
  }
}
