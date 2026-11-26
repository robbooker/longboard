import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { isStageRoom } from "@/lib/chatStageLive";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { isChatAdmin } from "@/lib/chatRole";
import { parseStageTicker } from "@/lib/chatStageLive";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { forgetStageState, setStageOnScreen, stageVideoConfig } from "@/lib/chatStageVideo";
import { parseChatRoom } from "@/lib/publicChat";

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
 */
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const body = await req.json().catch(() => null);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!isChatAdmin(auth) || auth.apiToken || auth.agent) return json({ error: "admin_only" }, 403);
  const room = parseChatRoom(body?.room);
  if (!room) return json({ error: "invalid_room" }, 400);
  // #524: only the rooms that offer live video (lib/chatStageLive.ts).
  if (!isStageRoom(room)) return json({ error: "stage_not_offered" }, 404);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const symbol = body.symbol === null ? null : parseStageTicker(body.symbol);
  if (body.symbol !== null && !symbol) return json({ error: "invalid_symbol" }, 400);
  const config = stageVideoConfig();
  if (!config) return json({ error: "video_off" }, 404);
  try {
    const onScreen = await setStageOnScreen(stageVideoApi(config), room, symbol);
    if (!onScreen) return json({ error: "not_started" }, 409);
    // This server reads the room again for the next status request; the signal carries the ticker
    // for stages already open (and each keeps the newest it has heard of).
    forgetStageState(room);
    publishRoomEventAfterResponse(room, { kind: "changed", topics: ["stage"], onScreen });
    return json({ onScreen });
  } catch {
    return json({ error: "livekit_unavailable" }, 502);
  }
}
