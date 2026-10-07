import * as Ably from "ably";
import { NextRequest, NextResponse } from "next/server";
import { allowedChatRooms } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { chatAblyKey, chatRealtimeRollout, chatRoomChannel } from "@/lib/chatRealtimeChannels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Signed locally (no network): subscribe-only access to exactly the rooms this account may read. */
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const key = chatAblyKey();
  const rollout = chatRealtimeRollout(process.env.CHAT_ABLY_ROLLOUT);
  if (!key || rollout === "off" || (rollout === "admins" && !auth.access.admin))
    return json({ error: "realtime_unavailable" }, 404);
  const rooms = allowedChatRooms(auth.access);
  if (!rooms.length) return json({ error: "room_forbidden" }, 403);
  const tokenRequest = await new Ably.Rest({ key }).auth.createTokenRequest({
    clientId: `chat:${auth.user.id}`,
    capability: Object.fromEntries(rooms.map((room) => [chatRoomChannel(room), ["subscribe"]])),
    ttl: 60 * 60 * 1000,
  });
  return json(tokenRequest);
}
