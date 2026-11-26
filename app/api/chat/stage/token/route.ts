import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { findChatMember } from "@/lib/chatMembers";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { stageReachable } from "@/lib/chatStageLive";
import { stageBody, stageOriginAllowed } from "@/lib/chatStageRequest";
import {
  parseStageRoom,
  parseStageTab,
  readStageState,
  sharedStageState,
  stageSeatFor,
  stageVideoConfig,
  stageVideoRoom,
  stageVideoSocketUrl,
} from "@/lib/chatStageVideo";
import { ChatTimingRateLimit } from "@/lib/chatTimings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// A viewer needs one token per connection (a reconnect reuses it). 20 in five minutes per account
// (per server instance) is far above normal use and stops a stuck page from minting them in a loop.
const limiter = new ChatTimingRateLimit(20, 5 * 60_000);

/**
 * #502: a short-lived LiveKit token to WATCH one room's live video. The same check as reading the
 * room's history (canAccessChatRoom), a browser sign-in only, and only while the room is live.
 * #512: an admin too: a room keeps its stream key for good, so "set up" is no reason to connect;
 * an admin's stage waits for the broadcast without a connection. The token can subscribe and
 * nothing else. It is never logged.
 * #522:
 *  - the member's access is read fresh from the database for this (never the 30-second sign-in
 *    memory): a token is asked for once per watch, and a member who was just suspended or lost the
 *    room must not get one from a server that has not heard;
 *  - the token is for one of the member's two seats in the room (lib/chatStageVideo.ts
 *    stageSeatFor), so one member can never hold more than two connections to a room, whatever
 *    they ask and whichever servers answer. `tab` (the page's own name for its player) and `seat`
 *    (which seat it would like) only choose between the member's own seats;
 *  - it lasts one minute (lib/chatStageLiveKit.ts);
 *  - the body must be a JSON object that names its room (400 otherwise).
 */
export async function POST(req: NextRequest) {
  if (!stageOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req, undefined, { fresh: true });
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  // People watch in a browser; a personal API token or an agent has no use for video.
  if (auth.apiToken || auth.agent || auth.access.botRooms) return json({ error: "browser_only" }, 403);
  const body = await stageBody(req);
  const room = parseStageRoom(body?.room);
  if (!room || !body) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const config = stageVideoConfig();
  if (!config) return json({ error: "video_off" }, 404);
  if (!limiter.allow(auth.user.id)) return json({ error: "rate_limited" }, 429);
  const api = stageVideoApi(config);
  const state = await sharedStageState(room, () => readStageState(api, room));
  if (!stageReachable({ admin: false, video: true }, state)) return json({ error: "not_live", state }, 409);
  const db = createChatAdminClient();
  if (!db) return json({ error: "unavailable" }, 503);
  let member;
  try {
    member = await findChatMember(db, auth.user.id);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  if (!member) return json({ error: "member_required" }, 403);
  try {
    const videoRoom = stageVideoRoom(room);
    const tab = parseStageTab(body.tab);
    const identity = await stageSeatFor(api, videoRoom, member.id, tab, typeof body.seat === "number" ? body.seat : 1);
    const token = await api.viewerToken(videoRoom, identity, member.display_name, tab ?? undefined);
    return json({ url: stageVideoSocketUrl(config), token, state });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
