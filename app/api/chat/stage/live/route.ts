import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { isChatAdmin } from "@/lib/chatRole";
import { stageKeyWasReset, stageMayHaveChanged } from "@/lib/chatStageChange";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { stageBody, stageOriginAllowed } from "@/lib/chatStageRequest";
import {
  forgetStageState,
  parseStageRoom,
  readStageKey,
  resetStageKey,
  stageKeyFor,
  stageStateOf,
  stageVideoConfig,
  type StageKey,
} from "@/lib/chatStageVideo";

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
  // #522: strictly: a request that names no room is refused, never taken to mean LB.
  const room = parseStageRoom(roomParam);
  if (!room) return { response: json({ error: "invalid_room" }, 400) };
  if (!canAccessChatRoom(auth.access, room)) return { response: json({ error: "room_forbidden" }, 403) };
  const config = stageVideoConfig();
  if (!config) return { response: json({ error: "video_off" }, 404) };
  return { room, api: stageVideoApi(config), admin: auth.user.id };
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
 *    #522: the LiveKit room is then closed, so nobody stays connected to a room with no broadcast.
 *  - "refresh": nothing changes at LiveKit (an admin's player sends it when the broadcast arrives
 *    or drops). #523: the room's state is read, and only if it is new to this server is everyone
 *    told to ask the status again and the room's message checked (lib/chatStageChange.ts).
 * There is no start and no end: the room is live while StreamYard is broadcasting to it.
 * #522: the body must be a JSON object that names its room (400 otherwise, before anything is read from it).
 */
export async function POST(req: NextRequest) {
  if (!stageOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const body = await stageBody(req);
  const gate = await adminFor(req, body?.room);
  if (gate.response) return gate.response;
  if (!body) return json({ error: "invalid_body" }, 400);
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
      stageKeyWasReset(room, api, admin);
      return json(broadcast(key));
    }
    if (body.action === "refresh") {
      await stageMayHaveChanged(room, api, { actor: admin });
      return json({ ok: true });
    }
  } catch {
    return json({ error: "livekit_unavailable" }, 502);
  }
  return json({ error: "invalid_action" }, 400);
}
