import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { findChatMember } from "@/lib/chatMembers";
import { isChatAdmin } from "@/lib/chatRole";
import { stageVideoApi } from "@/lib/chatStageLiveKit";
import { stageReachable } from "@/lib/chatStageLive";
import {
  readStageState,
  sharedStageState,
  stageVideoConfig,
  stageVideoRoom,
  stageVideoSocketUrl,
  stageViewerIdentity,
} from "@/lib/chatStageVideo";
import { ChatTimingRateLimit } from "@/lib/chatTimings";
import { parseChatRoom } from "@/lib/publicChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

// A viewer needs one token per connection (a reconnect reuses it). 20 in five minutes per account
// (per server instance) is far above normal use and stops a stuck page from minting them in a loop.
const limiter = new ChatTimingRateLimit(20, 5 * 60_000);

/**
 * #502: a short-lived LiveKit token to WATCH one room's live video. The same check as reading the
 * room's history (canAccessChatRoom), a browser sign-in only, and for a member only while the room
 * is live (an admin may also join a started room to see the broadcast arrive). The token can
 * subscribe and nothing else. It is never logged.
 */
export async function POST(req: NextRequest) {
  if (!requestOriginAllowed(req)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  // People watch in a browser; a personal API token or an agent has no use for video.
  if (auth.apiToken || auth.agent || auth.access.botRooms) return json({ error: "browser_only" }, 403);
  const body = await req.json().catch(() => null);
  const room = parseChatRoom(body?.room);
  if (!room) return json({ error: "invalid_room" }, 400);
  if (!canAccessChatRoom(auth.access, room)) return json({ error: "room_forbidden" }, 403);
  const config = stageVideoConfig();
  if (!config) return json({ error: "video_off" }, 404);
  if (!limiter.allow(auth.user.id)) return json({ error: "rate_limited" }, 429);
  const api = stageVideoApi(config);
  const state = await sharedStageState(room, () => readStageState(api, room));
  const admin = isChatAdmin(auth);
  if (!(admin ? state !== "off" : stageReachable({ admin: false, video: true }, state)))
    return json({ error: "not_live", state }, 409);
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
    const token = await api.viewerToken(
      stageVideoRoom(room),
      stageViewerIdentity(member.id, randomBytes(4).toString("hex")),
      member.display_name,
    );
    return json({ url: stageVideoSocketUrl(config), token, state });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
