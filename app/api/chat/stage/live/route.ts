import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { isChatAdmin } from "@/lib/chatRole";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import {
  endStageVideo,
  forgetStageState,
  startStageVideo,
  stageStateOf,
  stageVideoConfig,
  stageVideoRoom,
  type StageIngress,
} from "@/lib/chatStageVideo";
import { parseChatRoom, type ChatRoom } from "@/lib/publicChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The answers below can carry the stream key: never cached anywhere, never logged.
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** What an admin's start panel shows. The stream key is a secret: this goes to chat admins only. */
const broadcast = (ingress: StageIngress | undefined) =>
  ingress
    ? { state: stageStateOf([ingress]), address: ingress.url, streamKey: ingress.streamKey }
    : { state: "off" as const };

/** A chat admin, signed in through the browser (never an API token or an agent), for a real room. */
async function adminFor(req: NextRequest, roomParam: unknown) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return { response: json({ error: auth.error }, auth.status) };
  if (!isChatAdmin(auth) || auth.apiToken || auth.agent) return { response: json({ error: "admin_only" }, 403) };
  const room = parseChatRoom(roomParam);
  if (!room) return { response: json({ error: "invalid_room" }, 400) };
  if (!canAccessChatRoom(auth.access, room)) return { response: json({ error: "room_forbidden" }, 403) };
  const config = stageVideoConfig();
  if (!config) return { response: json({ error: "video_off" }, 404) };
  return { room, api: stageVideoApi(config) };
}

/** Everyone showing the room asks its status again. The signal carries no address or key. */
function changed(room: ChatRoom) {
  forgetStageState(room);
  publishRoomEventAfterResponse(room, { kind: "changed", topics: ["stage"] });
}

/** #502: the room's stream address and key, when live video has been started (admins only). */
export async function GET(req: NextRequest) {
  const gate = await adminFor(req, req.nextUrl.searchParams.get("room"));
  if (gate.response) return gate.response;
  try {
    return json(broadcast((await gate.api.ingresses(stageVideoRoom(gate.room)))[0]));
  } catch {
    return json({ error: "livekit_unavailable" }, 502);
  }
}

/**
 * #502: start or end a room's live video (admins only).
 *  - "start": the room's RTMP ingress, created only if there is none; answers the address and key.
 *  - "end": deletes it and closes the LiveKit room, so viewers are disconnected.
 *  - "refresh": nothing changes at LiveKit; everyone in the room is told to ask the status again
 *    (an admin's player sends it when the broadcast arrives or drops).
 */
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const body = await req.json().catch(() => null);
  const gate = await adminFor(req, body?.room);
  if (gate.response) return gate.response;
  const { room, api } = gate;
  try {
    if (body.action === "start") {
      const ingress = await startStageVideo(api, room);
      changed(room);
      return json(broadcast(ingress));
    }
    if (body.action === "end") {
      await endStageVideo(api, room);
      changed(room);
      return json(broadcast(undefined));
    }
    if (body.action === "refresh") {
      changed(room);
      return json({ ok: true });
    }
  } catch {
    return json({ error: "livekit_unavailable" }, 502);
  }
  return json({ error: "invalid_action" }, 400);
}
