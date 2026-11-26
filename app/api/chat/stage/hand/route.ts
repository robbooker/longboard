import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { findChatMember } from "@/lib/chatMembers";
import { isChatAdmin } from "@/lib/chatRole";
import {
  STAGE_HAND_MAX_IDENTITIES,
  isStageViewerIdentity,
  lowerAllStageHands,
  lowerStageHands,
  stageHandIsOwn,
} from "@/lib/chatStageHand";
import { stageReachable } from "@/lib/chatStageLive";
import { stageHandApi, stageVideoApi } from "@/lib/chatStageLiveKit";
import { readStageState, sharedStageState, stageVideoConfig, stageVideoRoom } from "@/lib/chatStageVideo";
import { ChatTimingRateLimit } from "@/lib/chatTimings";
import { parseChatRoom } from "@/lib/publicChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// Raising and lowering your own hand: 20 a minute per account (per server instance) is far more
// than anyone needs and stops a script from flickering a hand in front of the host.
const limiter = new ChatTimingRateLimit(20, 60_000);
// An admin lowering other people's hands, one at a time, in a busy room.
const adminLimiter = new ChatTimingRateLimit(120, 60_000);

/**
 * #508: raise or lower a hand while watching a room's live video.
 *  - { room, identity, raised: true }: raise the caller's own hand. `identity` is the caller's own
 *    connection to the LiveKit room (it must begin with their member id); only while the room is
 *    live (the token route's rule; #512: for an admin too, who is no longer connected to a room that
 *    is only waiting for its broadcast).
 *  - { room, identities: [...], raised: false } (or `identity`): lower. A member may lower only
 *    their own connections; a chat admin may lower anyone's in that room.
 *  - { room, all: true, raised: false }: a chat admin lowers every hand in the room.
 * The same check as reading the room (canAccessChatRoom), a browser sign-in only, same-origin.
 * The hand is an attribute on the viewer's LiveKit participant, set by this server: nothing is
 * saved in the database, and viewers' tokens stay watch-only. Nobody is ever put on camera.
 */
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (auth.apiToken || auth.agent || auth.access.botRooms) return json({ error: "browser_only" }, 403);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const room = parseChatRoom(body?.room);
  if (!room || !body) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  if (typeof body.raised !== "boolean") return json({ error: "invalid_request" }, 400);
  const admin = isChatAdmin(auth);
  const all = body.all === true;
  if (all && (body.raised || !admin)) return json({ error: "admin_only" }, 403);
  const named = Array.isArray(body.identities) ? body.identities : body.identity === undefined ? [] : [body.identity];
  if (!all && (!named.length || named.length > (body.raised ? 1 : STAGE_HAND_MAX_IDENTITIES) || !named.every(isStageViewerIdentity)))
    return json({ error: "invalid_identity" }, 400);
  const identities = [...new Set(named as string[])];
  const config = stageVideoConfig();
  if (!config) return json({ error: "video_off" }, 404);

  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  let member;
  try {
    member = await findChatMember(db, auth.user.id);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  if (!member) return json({ error: "member_required" }, 403);
  const own = identities.every((identity) => stageHandIsOwn(member.id, identity));
  // Raising is only ever for yourself, admin or not; lowering someone else's hand is an admin's job.
  if (!all && !own && (body.raised || !admin)) return json({ error: "not_your_hand" }, 403);
  if (!(all || !own ? adminLimiter : limiter).allow(auth.user.id)) return json({ error: "rate_limited" }, 429);

  const videoRoom = stageVideoRoom(room);
  try {
    const hands = stageHandApi(config);
    if (all) return json({ lowered: await lowerAllStageHands(hands, videoRoom) });
    if (!body.raised) return json({ raised: false, lowered: await lowerStageHands(hands, videoRoom, identities) });
    const state = await sharedStageState(room, () => readStageState(stageVideoApi(config), room));
    // #512: the token route's rule, which is the same for an admin now: only while the room is live.
    if (!stageReachable({ admin: false, video: true }, state)) return json({ error: "not_live", state }, 409);
    const at = Date.now();
    // Not in the room (never joined, or already disconnected): there is no hand to raise.
    if (!(await hands.setHand(videoRoom, identities[0], at))) return json({ error: "not_watching" }, 409);
    return json({ raised: true, at });
  } catch {
    return json({ error: "livekit_unavailable" }, 502);
  }
}
