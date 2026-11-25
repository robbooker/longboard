import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { isChatAdmin } from "@/lib/chatRole";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { stageNoticeAfterResponse } from "@/lib/chatStageNotifyServer";
import {
  forgetStageState,
  readStageKey,
  resetStageKey,
  stageKeyFor,
  stageStateOf,
  stageVideoConfig,
  type StageKey,
  type StageVideoApi,
} from "@/lib/chatStageVideo";
import { parseChatRoom, type ChatRoom } from "@/lib/publicChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// #503: after the answer, a broadcast that stopped sending is given a few seconds to come back.
export const maxDuration = 60;
// The answers below can carry the stream key: never cached anywhere, never logged.
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * What an admin's "Live video" card shows. The stream key is a secret: this goes to chat admins
 * only. `extra`: how many other ingresses LiveKit has for the room (normally none; they are left
 * alone, and each one's key still works until "Reset key"). `created`: the key was made just now.
 */
const broadcast = (key: StageKey | null) =>
  key
    ? { state: stageStateOf([key.ingress]), address: key.ingress.url, streamKey: key.ingress.streamKey, ...(key.extra ? { extra: key.extra } : {}), ...(key.created ? { created: true } : {}) }
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
  return { room, api: stageVideoApi(config), admin: auth.user.id };
}

/**
 * Everyone showing the room asks its status again. The signal carries no address or key.
 * #503: then, after the answer, the room's "live now" message and its notifications are brought in
 * line with LiveKit (lib/chatStageNotify.ts): the broadcast arriving is announced once, and its
 * stopping (a reset key cuts it off) marks the message as ended.
 */
function changed(room: ChatRoom, api: StageVideoApi, admin: string) {
  forgetStageState(room);
  publishRoomEventAfterResponse(room, { kind: "changed", topics: ["stage"] });
  stageNoticeAfterResponse(room, api, admin);
}

/**
 * #512: the room's stream address and key, read only (admins only): `{ state: "off" }` for a room
 * that has not been set up. Nothing is made or changed by a GET.
 */
export async function GET(req: NextRequest) {
  const gate = await adminFor(req, req.nextUrl.searchParams.get("room"));
  if (gate.response) return gate.response;
  try {
    return json(broadcast(await readStageKey(gate.api, gate.room)));
  } catch {
    return json({ error: "livekit_unavailable" }, 502);
  }
}

/**
 * #512: a room's permanent stream address and key (admins only, same-origin, browser sign-in).
 *  - "open": what the admin's "Live video" card asks when it appears. Answers the room's address
 *    and key: the ingress LiveKit already has for the room, always; one is made only the first time,
 *    when the room has none. Nothing is ever deleted or replaced by it.
 *  - "reset": the admin's "Reset key", after confirming. The room's ingress is deleted and a new one
 *    made: the old key stops working at once and a broadcast using it is cut off.
 *  - "refresh": nothing changes at LiveKit; everyone in the room is told to ask the status again
 *    (an admin's player sends it when the broadcast arrives or drops).
 * There is no start and no end: the room is live while StreamYard is broadcasting to it.
 */
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const body = await req.json().catch(() => null);
  const gate = await adminFor(req, body?.room);
  if (gate.response) return gate.response;
  const { room, api, admin } = gate;
  try {
    if (body.action === "open") {
      const key = await stageKeyFor(api, room);
      if (key.created) {
        // The room now has its key (it was "off"): pages showing it ask the status again.
        forgetStageState(room);
        publishRoomEventAfterResponse(room, { kind: "changed", topics: ["stage"] });
      }
      return json(broadcast(key));
    }
    if (body.action === "reset") {
      const key = await resetStageKey(api, room);
      changed(room, api, admin);
      return json(broadcast(key));
    }
    if (body.action === "refresh") {
      changed(room, api, admin);
      return json({ ok: true });
    }
  } catch {
    return json({ error: "livekit_unavailable" }, 502);
  }
  return json({ error: "invalid_action" }, 400);
}
