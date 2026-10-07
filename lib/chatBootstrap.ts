import "server-only";
import { NextRequest } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient, readPublicRoomState } from "@/lib/chatAdmin";
import type { ChatAuthResult } from "@/lib/chatAuth";
import { featureAccess } from "@/lib/chatFeatures";
import { findChatMember } from "@/lib/chatMembers";
import { readRoomOpening } from "@/lib/chatRoomOpening";
import { readHistory } from "@/lib/chatReads/history";
import { readCounts } from "@/lib/chatReads/counts";
import type { ChatBootstrap, ChatBootstrapOpening } from "@/lib/chatBootstrapTypes";
import type { ChatRoom } from "@/lib/publicChat";

/** Request-local only. Never cache this result across identities or requests. */
export async function loadChatBootstrap(auth: ChatAuthResult, room: ChatRoom): Promise<ChatBootstrap> {
  if (!auth.ok || !canAccessChatRoom(auth.access, room)) throw new Error("room_forbidden");
  const db = createChatAdminClient();
  if (!db) throw new Error("chat_unavailable");
  const history = async (window = "") => {
    // Shared readers preserve the same room authorization as later reconciliations.
    const response = await readHistory(
      new NextRequest(`https://chat.internal/api/chat/history?room=${room}${window}`),
      auth,
    );
    if (!response.ok) throw new Error("history_unavailable");
    const data = await response.json();
    const ids = data.messages.map((m: { id: string }) => m.id).join(",");
    const counts = await readCounts(
      new NextRequest(`https://chat.internal/api/chat/thread-counts?room=${room}&ids=${ids}`),
      auth,
    );
    return { ...data, counts: counts.ok ? (await counts.json()).counts : {} };
  };
  const memberRequest = findChatMember(db, auth.user.id);
  // The landing spot is optional: on any failure the client falls back to /api/chat/opening.
  const openingRequest = memberRequest
    .then((member) => (member ? readRoomOpening(db, auth.user.id, member.id, room) : null))
    .catch(() => null);
  const [member, roomState, latest, features, opening] = await Promise.all([
    memberRequest,
    readPublicRoomState(db, room),
    history(),
    featureAccess(auth),
    openingRequest,
  ]);
  let initial = latest;
  let landing: ChatBootstrapOpening | undefined;
  if (opening?.ok) {
    const { messageId, unreadMessageId, parentId, readThrough } = opening.body;
    landing = { messageId, unreadMessageId, parentId, readThrough, window: null };
    // Only page around the anchor when it is older than the latest page already loaded.
    if (messageId && !latest.messages.some((m: { id: string }) => m.id === messageId)) {
      try {
        initial = await history(`&around=${messageId}`);
        landing.window = {
          range: initial.range ?? null,
          hasMore: !!initial.hasMore,
          hasNewer: !!initial.hasNewer,
        };
      } catch {
        initial = latest;
        landing = undefined;
      }
    }
  }
  return {
    accountId: auth.user.id,
    room,
    member,
    roomState,
    messages: initial.messages,
    reactions: initial.reactions,
    counts: initial.counts,
    featureChannel: !!features,
    ...(landing ? { opening: landing } : {}),
  };
}
