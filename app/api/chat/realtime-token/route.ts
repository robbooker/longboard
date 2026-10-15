import * as Ably from "ably";
import { NextRequest, NextResponse } from "next/server";
import { allowedChatRooms, canWriteChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { chatAblyKey, chatRealtimeRollout } from "@/lib/chatRealtimeChannels";
import { chatRealtimeCapability, chatTypingClientId, chatTypingEnabled } from "@/lib/chatTyping";
import { chatTypingGrants } from "@/lib/chatTypingGrants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * Signed locally: subscribe-only access to exactly the rooms this account may read, plus
 * typing channels (publish only where the member may post). The clientId is the member's
 * id, so Ably stamps every typing signal with the sender's real login.
 */
export async function GET(req: NextRequest) {
  const auth = await requireChatUser(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const key = chatAblyKey();
  const rollout = chatRealtimeRollout(process.env.CHAT_ABLY_ROLLOUT);
  if (!key || rollout === "off" || (rollout === "admins" && !auth.access.admin))
    return json({ error: "realtime_unavailable" }, 404);
  const rooms = allowedChatRooms(auth.access);
  if (!rooms.length) return json({ error: "room_forbidden" }, 403);
  const admin = chatTypingEnabled(process.env.CHAT_TYPING) ? createChatAdminClient() : null;
  const grants = admin ? await chatTypingGrants(admin, auth.user.id) : { memberId: null, conversations: [] };
  const typing = !!grants.memberId;
  const tokenRequest = await new Ably.Rest({ key }).auth.createTokenRequest({
    // A member id is public (it is on every message); the account id never leaves the server.
    clientId: grants.memberId ? chatTypingClientId(grants.memberId) : `chat:${auth.user.id}`,
    capability: chatRealtimeCapability({
      rooms,
      writableRooms: rooms.filter((room) => canWriteChatRoom(auth.access, room)),
      conversations: grants.conversations,
      typing,
    }),
    ttl: 60 * 60 * 1000,
  });
  return json(tokenRequest);
}
