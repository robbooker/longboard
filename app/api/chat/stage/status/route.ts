import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { readStageOnScreen, readStageState, sharedStageOnScreen, sharedStageState, stageVideoConfig } from "@/lib/chatStageVideo";
import { parseChatRoom } from "@/lib/publicChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #502: whether one room's live video is off, waiting for the broadcast, or live. Asked by a page
 * only for the room it is showing (when the room opens, and when a "stage" signal arrives), and
 * answered from LiveKit at most once every few seconds per room by this server (sharedStageState).
 * Only someone who can read the room is told. Carries no address, key or token.
 * #507: while the room's live video is started, also the stock the host put on screen (`onScreen`,
 * or null), read from the LiveKit room and remembered for the same few seconds. A room that is off
 * asks LiveKit nothing more than before.
 */
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const room = parseChatRoom(req.nextUrl.searchParams.get("room"));
  if (!room) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const config = stageVideoConfig();
  if (!config) return json({ state: "off", video: false });
  const api = stageVideoApi(config);
  const state = await sharedStageState(room, () => readStageState(api, room));
  const onScreen = state === "off" ? null : await sharedStageOnScreen(room, () => readStageOnScreen(api, room));
  return json({ state, video: true, onScreen });
}
